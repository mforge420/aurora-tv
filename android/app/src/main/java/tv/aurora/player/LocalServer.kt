package tv.aurora.player

import android.content.Context
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.BufferedInputStream
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPInputStream

/**
 * In-app replacement for the Node server: serves the bundled UI from assets and
 * implements /api/fetch and /api/stream natively, so no CORS restrictions apply.
 */
class LocalServer(private val context: Context) {
    init { cacheDir = context.cacheDir }

    companion object {
        const val HOST = "appassets.androidplatform.net"
        const val ORIGIN = "https://$HOST"
        const val DEFAULT_UA =
            "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"

        /** Set by the app before first use; enables a disk cache for logos/posters. */
        @Volatile var cacheDir: java.io.File? = null

        val http: OkHttpClient by lazy { buildHttp() }
        private fun buildHttp(): OkHttpClient = OkHttpClient.Builder()
            .apply { cacheDir?.let { cache(okhttp3.Cache(java.io.File(it, "http"), 80L * 1024 * 1024)) } }
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(150, TimeUnit.SECONDS) // providers' xmltv.php can take minutes to start sending
            .followRedirects(true)
            .followSslRedirects(true)
            .retryOnConnectionFailure(true)
            .build()

        /** Same connection pool, but a short read timeout so stalled streams fail fast and reconnect. */
        val media: OkHttpClient by lazy { http.newBuilder().cache(null).readTimeout(20, TimeUnit.SECONDS).build() }

        private val MIME = mapOf(
            "html" to "text/html", "js" to "text/javascript", "mjs" to "text/javascript",
            "css" to "text/css", "json" to "application/json", "webmanifest" to "application/manifest+json",
            "svg" to "image/svg+xml", "png" to "image/png", "ico" to "image/x-icon", "woff2" to "font/woff2",
        )
    }

    fun handle(req: WebResourceRequest): WebResourceResponse? {
        val url = req.url
        if (url.host != HOST) return null
        val path = url.path ?: "/"
        return try {
            when (path) {
                "/api/health" -> json(200, """{"ok":true,"native":true}""")
                "/api/fetch" -> proxy(req, rewriteHls = false)
                "/api/stream" -> proxy(req, rewriteHls = true)
                else -> asset(path)
            }
        } catch (e: Exception) {
            json(502, """{"error":${quote("Upstream unreachable: " + (e.message ?: e.javaClass.simpleName))}}""")
        }
    }

    // ------------------------------------------------------------------ assets
    private fun asset(path: String): WebResourceResponse {
        var p = if (path == "/" || path.isEmpty()) "/index.html" else path
        if (p.contains("..")) return json(403, """{"error":"forbidden"}""")
        val ext = p.substringAfterLast('.', "")
        if (ext.isEmpty()) p = "/index.html" // SPA fallback
        return try {
            val stream = context.assets.open("www$p")
            val mime = MIME[p.substringAfterLast('.')] ?: "application/octet-stream"
            WebResourceResponse(mime, if (mime.startsWith("text") || mime.contains("json") || mime.contains("svg")) "utf-8" else null,
                200, "OK", mapOf("Cache-Control" to "no-cache"), stream)
        } catch (e: IOException) {
            json(404, """{"error":"not found"}""")
        }
    }

    // ------------------------------------------------------------------ proxy
    private fun proxy(req: WebResourceRequest, rewriteHls: Boolean): WebResourceResponse {
        val target = req.url.getQueryParameter("url") ?: return json(400, """{"error":"missing url"}""")
        if (!target.startsWith("http://") && !target.startsWith("https://")) return json(400, """{"error":"bad url"}""")
        val ua = req.url.getQueryParameter("ua")?.takeIf { it.isNotBlank() }
            ?: req.requestHeaders.entries.firstOrNull { it.key.equals("x-aurora-ua", true) }?.value
            ?: DEFAULT_UA
        val ref = req.url.getQueryParameter("ref")
        val b = Request.Builder().url(target).header("User-Agent", ua).header("Accept", "*/*")
        val looksImage = Regex("\\.(png|jpe?g|gif|webp|svg|bmp|ico)(\\?|$)", RegexOption.IGNORE_CASE).containsMatchIn(target)
        if (!rewriteHls && looksImage) b.cacheControl(okhttp3.CacheControl.Builder().maxStale(7, TimeUnit.DAYS).build())
        ref?.let { b.header("Referer", it) }
        req.requestHeaders.entries.firstOrNull { it.key.equals("range", true) }?.let { b.header("Range", it.value) }

        val resp = http.newCall(b.build()).execute()
        val body = resp.body ?: return json(resp.code, "{}")
        val ct = resp.header("Content-Type")?.lowercase() ?: ""
        val finalUrl = resp.request.url.toString()
        val headers = mutableMapOf(
            "Access-Control-Allow-Origin" to "*",
            "Cache-Control" to "no-store",
        )
        val status = if (resp.code in 300..399) 502 else resp.code
        val reason = resp.message.ifBlank { "OK" }

        if (rewriteHls && resp.isSuccessful &&
            (ct.contains("mpegurl") || Uri.parse(finalUrl).path.orEmpty().lowercase().matches(Regex(".*\\.m3u8?$")))
        ) {
            val text = body.string()
            if (text.trimStart().startsWith("#EXTM3U")) {
                val out = rewriteM3u8(text, finalUrl, req.url.getQueryParameter("ua"), ref)
                return WebResourceResponse("application/vnd.apple.mpegurl", "utf-8", 200, "OK", headers,
                    ByteArrayInputStream(out.toByteArray()))
            }
            return WebResourceResponse(ct.ifEmpty { "text/plain" }, "utf-8", status, reason, headers,
                ByteArrayInputStream(text.toByteArray()))
        }

        var stream: InputStream = body.byteStream()
        var mime = ct.substringBefore(';').ifEmpty { "application/octet-stream" }
        if (mime.startsWith("image/") && resp.isSuccessful) {
            // let the WebView keep logos in memory between redraws
            headers["Cache-Control"] = "public, max-age=604800"
            return WebResourceResponse(mime, null, status, reason, headers, stream)
        }
        if (!rewriteHls) {
            // transparently gunzip .xml.gz guides
            val bis = BufferedInputStream(stream, 65536)
            bis.mark(4)
            val b0 = bis.read(); val b1 = bis.read()
            bis.reset()
            stream = if (b0 == 0x1f && b1 == 0x8b) { mime = "application/xml"; GZIPInputStream(bis, 65536) } else bis
        } else {
            resp.header("Content-Length")?.let { headers["Content-Length"] = it }
            resp.header("Content-Range")?.let { headers["Content-Range"] = it }
            resp.header("Accept-Ranges")?.let { headers["Accept-Ranges"] = it }
        }
        return WebResourceResponse(mime, null, status, reason, headers, stream)
    }

    private fun rewriteM3u8(text: String, base: String, ua: String?, ref: String?): String {
        val baseUri = java.net.URI(base)
        fun resolve(u: String) = try { baseUri.resolve(u.trim()).toString() } catch (e: Exception) { u }
        fun prox(u: String): String {
            val sb = StringBuilder("/api/stream?url=").append(enc(resolve(u)))
            ua?.let { sb.append("&ua=").append(enc(it)) }
            ref?.let { sb.append("&ref=").append(enc(it)) }
            return sb.toString()
        }
        val uriAttr = Regex("URI=\"([^\"]+)\"")
        return text.lineSequence().joinToString("\n") { line ->
            val l = line.trim()
            when {
                l.isEmpty() -> line
                l.startsWith("#") -> uriAttr.replace(line) { "URI=\"${prox(it.groupValues[1])}\"" }
                else -> prox(l)
            }
        }
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
    private fun quote(s: String) = "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ") + "\""
    private fun json(code: Int, body: String) = WebResourceResponse(
        "application/json", "utf-8", code, if (code == 200) "OK" else "Error",
        mapOf("Access-Control-Allow-Origin" to "*"), ByteArrayInputStream(body.toByteArray()),
    )
}
