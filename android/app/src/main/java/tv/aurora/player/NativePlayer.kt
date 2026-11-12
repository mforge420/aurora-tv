package tv.aurora.player

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.source.BehindLiveWindowException
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * ExoPlayer wrapper driven from the web UI. Picks HLS or progressive (TS/MP4/MKV),
 * falls back between them, and auto-reconnects live streams.
 */
@OptIn(UnstableApi::class)
class NativePlayer(
    private val context: Context,
    private val view: PlayerView,
    private val emit: (type: String, data: String) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private var player: ExoPlayer? = null
    private var req: JSONObject? = null
    private var kinds = listOf<String>()
    private var kindIdx = 0
    private var started = false
    private var retries = 0
    private var lastKind = ""

    @Volatile var tracksJson: String = "{\"audio\":[],\"text\":[],\"video\":[]}"
    @Volatile var statsJson: String = "{}"

    private val ticker = object : Runnable {
        override fun run() {
            val p = player ?: return
            val dur = if (p.duration == C.TIME_UNSET || p.isCurrentMediaItemLive) -1.0 else p.duration / 1000.0
            emit("time", JSONObject()
                .put("pos", p.currentPosition / 1000.0)
                .put("dur", dur)
                .put("buf", (p.totalBufferedDuration) / 1000.0)
                .put("playing", p.isPlaying).toString())
            updateStats()
            main.postDelayed(this, 500)
        }
    }

    private fun ensure(): ExoPlayer {
        player?.let { return it }
        val renderers = DefaultRenderersFactory(context)
            .setEnableDecoderFallback(true)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER)
        val load = DefaultLoadControl.Builder()
            .setBufferDurationsMs(15_000, 50_000, 1_500, 3_000)
            .build()
        val p = ExoPlayer.Builder(context, renderers).setLoadControl(load).build()
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
            .setPreferredAudioLanguage(Locale.getDefault().language)
            .setPreferredTextLanguage(Locale.getDefault().language)
            .build()
        p.addListener(listener)
        view.player = p
        player = p
        return p
    }

    // ------------------------------------------------------------------ API
    fun play(json: String) {
        val r = JSONObject(json)
        req = r
        started = false; retries = 0
        val url = r.getString("url")
        val type = Util.inferContentType(Uri.parse(url))
        kinds = when (type) {
            C.CONTENT_TYPE_HLS -> listOf("hls", "progressive")
            C.CONTENT_TYPE_OTHER -> {
                val path = Uri.parse(url).path.orEmpty().lowercase()
                if (Regex(".*\\.(ts|mp4|mkv|avi|mov|m4v|webm|flv|mp3|aac)$").matches(path)) listOf("progressive", "hls")
                else listOf("progressive", "hls") // extension-less: TS is by far the most common, sniffed by extractors
            }
            else -> listOf("progressive")
        }
        kindIdx = 0
        emit("state", "loading")
        start(r.optDouble("startAt", 0.0))
    }

    private fun start(startAt: Double) {
        val r = req ?: return
        val p = ensure()
        val kind = kinds[kindIdx]
        lastKind = kind
        p.setMediaSource(source(r, kind))
        if (startAt > 0) p.seekTo((startAt * 1000).toLong())
        p.prepare()
        p.playWhenReady = true
        main.removeCallbacks(ticker); main.post(ticker)
    }

    private fun source(r: JSONObject, kind: String): MediaSource {
        val ua = r.optString("ua").ifBlank { LocalServer.DEFAULT_UA }
        val headers = mutableMapOf<String, String>()
        r.optString("ref").takeIf { it.isNotBlank() }?.let { headers["Referer"] = it }
        val ds = OkHttpDataSource.Factory(LocalServer.http).setUserAgent(ua).setDefaultRequestProperties(headers)
        val url = r.getString("url")
        return if (kind == "hls") {
            HlsMediaSource.Factory(ds).setAllowChunklessPreparation(true)
                .createMediaSource(MediaItem.Builder().setUri(url).setMimeType(MimeTypes.APPLICATION_M3U8).build())
        } else {
            val ex = DefaultExtractorsFactory()
                .setTsExtractorFlags(DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES or DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS)
                .setConstantBitrateSeekingEnabled(true)
            ProgressiveMediaSource.Factory(ds, ex).createMediaSource(MediaItem.fromUri(url))
        }
    }

    fun stop() {
        req = null
        main.removeCallbacks(ticker)
        player?.run { stop(); clearMediaItems() }
        view.keepScreenOn = false
        emit("state", "idle")
    }
    fun pause() { player?.pause() }
    fun resume() { player?.play() }
    fun seek(sec: Double) { player?.seekTo((sec * 1000).toLong()) }
    fun setVolume(v: Float) { player?.volume = v.coerceIn(0f, 1f) }
    fun setResize(mode: String) {
        view.resizeMode = when (mode) {
            "cover" -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
            "fill" -> AspectRatioFrameLayout.RESIZE_MODE_FILL
            else -> AspectRatioFrameLayout.RESIZE_MODE_FIT
        }
    }
    fun release() { main.removeCallbacks(ticker); player?.release(); player = null }

    fun selectTrack(type: String, id: String) {
        val p = player ?: return
        val trackType = when (type) { "audio" -> C.TRACK_TYPE_AUDIO; "text" -> C.TRACK_TYPE_TEXT; else -> C.TRACK_TYPE_VIDEO }
        val b = p.trackSelectionParameters.buildUpon()
        when (id) {
            "off" -> b.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
            "auto" -> b.clearOverridesOfType(trackType).setTrackTypeDisabled(trackType, false)
            else -> {
                val (g, t) = id.split(":").map { it.toInt() }
                val group = p.currentTracks.groups.getOrNull(g) ?: return
                b.setTrackTypeDisabled(trackType, false)
                    .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, t))
            }
        }
        p.trackSelectionParameters = b.build()
    }

    // ------------------------------------------------------------------ events
    private val listener = object : Player.Listener {
        override fun onPlaybackStateChanged(state: Int) {
            val p = player ?: return
            when (state) {
                Player.STATE_BUFFERING -> emit("state", if (started) "buffering" else "loading")
                Player.STATE_READY -> {
                    if (!started) { started = true; retries = 0; emit("started", lastKind) }
                    emit("state", if (p.playWhenReady) "playing" else "paused")
                }
                Player.STATE_ENDED -> emit("state", "ended")
                Player.STATE_IDLE -> {}
            }
        }
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            view.keepScreenOn = isPlaying
            val p = player ?: return
            if (p.playbackState == Player.STATE_READY) emit("state", if (isPlaying) "playing" else "paused")
        }
        override fun onPlayerError(error: PlaybackException) {
            val p = player ?: return
            val r = req ?: return
            if (error.cause is BehindLiveWindowException || error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
                p.seekToDefaultPosition(); p.prepare(); return
            }
            if (!started && kindIdx < kinds.size - 1) {      // try the other container type
                kindIdx++; start(r.optDouble("startAt", 0.0)); return
            }
            val live = r.optBoolean("live", true)
            if (started && live && retries < 6) {              // live auto-reconnect
                retries++
                emit("state", "reconnecting")
                val delay = minOf(8000L, 800L * retries)
                main.postDelayed({ if (req === r) start(0.0) }, delay)
                return
            }
            if (started && !live && retries < 3) {             // VOD: resume where we were
                retries++
                val pos = p.currentPosition / 1000.0
                emit("state", "reconnecting")
                main.postDelayed({ if (req === r) start(pos) }, 1500)
                return
            }
            emit("error", error.errorCodeName + (error.message?.let { ": $it" } ?: ""))
        }
        override fun onTracksChanged(tracks: Tracks) { updateTracks(tracks); emit("tracks", "") }
        override fun onVideoSizeChanged(videoSize: VideoSize) { updateStats() }
    }

    private fun label(f: Format, i: Int, type: Int): String {
        val parts = mutableListOf<String>()
        val name = f.label ?: f.language?.let { Locale(it).displayLanguage.replaceFirstChar { c -> c.uppercase() } }
        when (type) {
            C.TRACK_TYPE_VIDEO -> {
                parts += if (f.height > 0) "${f.height}p" else "Track ${i + 1}"
                if (f.bitrate > 0) parts += String.format(Locale.US, "%.1f Mbps", f.bitrate / 1e6)
            }
            C.TRACK_TYPE_AUDIO -> {
                parts += name ?: "Track ${i + 1}"
                codecName(f.sampleMimeType)?.let { parts += it }
                if (f.channelCount > 0) parts += when (f.channelCount) { 1 -> "Mono"; 2 -> "Stereo"; 6 -> "5.1"; 8 -> "7.1"; else -> "${f.channelCount}ch" }
            }
            else -> parts += name ?: "Subtitles ${i + 1}"
        }
        return parts.joinToString(" · ")
    }
    private fun codecName(m: String?) = when (m) {
        MimeTypes.AUDIO_AC3 -> "Dolby Digital"; MimeTypes.AUDIO_E_AC3, MimeTypes.AUDIO_E_AC3_JOC -> "Dolby Digital+"
        MimeTypes.AUDIO_AC4 -> "AC-4"; MimeTypes.AUDIO_DTS, MimeTypes.AUDIO_DTS_HD -> "DTS"
        MimeTypes.AUDIO_AAC -> "AAC"; MimeTypes.AUDIO_MPEG, MimeTypes.AUDIO_MPEG_L2 -> "MPEG"; MimeTypes.AUDIO_OPUS -> "Opus"
        else -> null
    }

    private fun updateTracks(tracks: Tracks) {
        val audio = JSONArray(); val text = JSONArray(); val video = JSONArray()
        var textSelected = false; var videoOverridden = false
        val params = player?.trackSelectionParameters
        tracks.groups.forEachIndexed { g, group ->
            for (t in 0 until group.length) {
                if (!group.isTrackSupported(t)) continue
                val f = group.getTrackFormat(t)
                val o = JSONObject().put("id", "$g:$t").put("label", label(f, t, group.type)).put("active", group.isTrackSelected(t))
                when (group.type) {
                    C.TRACK_TYPE_AUDIO -> audio.put(o)
                    C.TRACK_TYPE_TEXT -> { text.put(o); if (group.isTrackSelected(t)) textSelected = true }
                    C.TRACK_TYPE_VIDEO -> { video.put(o.put("h", f.height)); if (params?.overrides?.containsKey(group.mediaTrackGroup) == true) videoOverridden = true }
                }
            }
        }
        tracksJson = JSONObject().put("audio", audio).put("text", text).put("video", video)
            .put("textOn", textSelected).put("videoAuto", !videoOverridden).toString()
    }

    private fun updateStats() {
        val p = player ?: return
        val v = p.videoFormat; val a = p.audioFormat
        val o = JSONObject().put("engine", "ExoPlayer · $lastKind")
        if (p.videoSize.width > 0) o.put("res", "${p.videoSize.width}×${p.videoSize.height}")
        v?.let { o.put("video", listOfNotNull(it.codecs ?: it.sampleMimeType, if (it.frameRate > 0) "${it.frameRate.toInt()}fps" else null).joinToString(" ")) }
        v?.bitrate?.takeIf { it > 0 }?.let { o.put("bitrate", String.format(Locale.US, "%.1f Mbps", it / 1e6)) }
        a?.let { o.put("audio", listOfNotNull(codecName(it.sampleMimeType) ?: it.sampleMimeType, if (it.channelCount > 0) "${it.channelCount}ch" else null).joinToString(" ")) }
        o.put("buffer", String.format(Locale.US, "%.1fs", p.totalBufferedDuration / 1000.0))
        statsJson = o.toString()
    }
}
