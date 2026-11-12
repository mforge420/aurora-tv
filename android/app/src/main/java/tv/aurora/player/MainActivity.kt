package tv.aurora.player

import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Rect
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.webkit.ConsoleMessage
import android.webkit.RenderProcessGoneDetail
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.OptIn
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.PlayerView
import androidx.webkit.WebViewCompat
import org.json.JSONObject
import java.io.File

@OptIn(UnstableApi::class)
class MainActivity : ComponentActivity() {

    private lateinit var root: FrameLayout
    private lateinit var web: WebView
    private lateinit var playerView: PlayerView
    private lateinit var player: NativePlayer
    private lateinit var server: LocalServer
    private lateinit var updater: Updater
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var rectAnim: ValueAnimator? = null
    private val crashTimes = mutableListOf<Long>()

    // OK / Select: WebView only sees the press on release, so long-press is detected here.
    @Volatile private var textFocus = false
    private val keyHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private var okDown = false
    private var okLongFired = false
    private val okLong = Runnable { okLongFired = true; sendKey("LongOk") }

    private val pickFile = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        val uris = WebChromeClient.FileChooserParams.parseResult(res.resultCode, res.data)
        fileCallback?.onReceiveValue(uris); fileCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED)
        goImmersive()
        server = LocalServer(applicationContext)
        updater = Updater(this) { data -> emitToWeb("update", data) }

        root = FrameLayout(this).apply { setBackgroundColor(Color.parseColor("#06070C")) }

        // Video surface lives *under* the transparent WebView UI.
        playerView = PlayerView(this).apply {
            useController = false
            setShutterBackgroundColor(Color.BLACK)
            setBackgroundColor(Color.BLACK)
            isFocusable = false
            isFocusableInTouchMode = false
            visibility = View.GONE
        }
        root.addView(playerView, FrameLayout.LayoutParams(0, 0))

        createWebView()
        setContentView(root)

        player = NativePlayer(this, playerView) { type, data -> emitToWeb(type, data) }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = sendKey("Escape")
        })

        if (savedInstanceState == null) web.loadUrl("${LocalServer.ORIGIN}/index.html")
        else web.restoreState(savedInstanceState)
        web.requestFocus()
        checkWebViewVersion()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView() {
        web = WebView(this).apply {
            setBackgroundColor(Color.TRANSPARENT)
            isFocusable = true
            isFocusableInTouchMode = true
            overScrollMode = View.OVER_SCROLL_NEVER
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
        }
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            textZoom = 100
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            cacheMode = WebSettings.LOAD_DEFAULT
            userAgentString = "$userAgentString LumoraTV/${packageManager.getPackageInfo(packageName, 0).versionName}"
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                server.handle(request)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == LocalServer.HOST) return false
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                return true
            }

            /** The page renderer died (OOM on low-end TV boxes, GPU driver crash…): rebuild instead of crashing the app. */
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                Log.w("Aurora", "WebView renderer gone (crash=${detail.didCrash()}), recreating")
                val now = System.currentTimeMillis()
                crashTimes.add(now); crashTimes.removeAll { now - it > 60_000 }
                if (::player.isInitialized) player.stop()
                root.removeView(view)
                view.destroy()
                if (isFinishing || isDestroyed) return true
                if (crashTimes.size > 3) {   // crashing in a loop: stop and tell the user
                    AlertDialog.Builder(this@MainActivity)
                        .setTitle("Display engine keeps crashing")
                        .setMessage("Android System WebView on this device keeps crashing. Update “Android System WebView” from the store, then reopen Lumora TV.")
                        .setPositiveButton("Close") { _, _ -> finish() }
                        .setCancelable(false).show()
                    return true
                }
                createWebView()
                web.loadUrl("${LocalServer.ORIGIN}/index.html")
                web.requestFocus()
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(v: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = cb
                return try {
                    val i = Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
                    pickFile.launch(Intent.createChooser(i, "Choose playlist")); true
                } catch (e: Exception) { fileCallback = null; false }
            }
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                Log.d("AuroraWeb", "${m.messageLevel()}: ${m.message()} (${m.sourceId()}:${m.lineNumber()})")
                return true
            }
        }
        web.addJavascriptInterface(Bridge(), "AuroraNative")
        root.addView(web, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
    }

    // ------------------------------------------------------------------ keys
    /** Remote buttons that WebView doesn't translate into useful DOM keys. */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val isOk = event.keyCode == KeyEvent.KEYCODE_DPAD_CENTER || event.keyCode == KeyEvent.KEYCODE_ENTER ||
            event.keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER || event.keyCode == KeyEvent.KEYCODE_BUTTON_A
        // Text fields keep the native OK so the on-screen keyboard opens
        if (isOk && !textFocus) {
            when (event.action) {
                KeyEvent.ACTION_DOWN -> if (event.repeatCount == 0) {
                    okDown = true; okLongFired = false
                    keyHandler.removeCallbacks(okLong)
                    keyHandler.postDelayed(okLong, 550)
                }
                KeyEvent.ACTION_UP -> {
                    keyHandler.removeCallbacks(okLong)
                    if (okDown && !okLongFired) sendKey("Enter")
                    okDown = false
                }
            }
            return true
        }
        val key = when (event.keyCode) {
            KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_ESCAPE -> "Escape"
            KeyEvent.KEYCODE_CHANNEL_UP, KeyEvent.KEYCODE_PAGE_UP -> "PageUp"
            KeyEvent.KEYCODE_CHANNEL_DOWN, KeyEvent.KEYCODE_PAGE_DOWN -> "PageDown"
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_HEADSETHOOK -> "MediaPlayPause"
            KeyEvent.KEYCODE_MEDIA_PLAY -> "MediaPlay"
            KeyEvent.KEYCODE_MEDIA_PAUSE -> "MediaPause"
            KeyEvent.KEYCODE_MEDIA_STOP -> "MediaStop"
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> "MediaFastForward"
            KeyEvent.KEYCODE_MEDIA_REWIND -> "MediaRewind"
            KeyEvent.KEYCODE_MEDIA_NEXT -> "MediaTrackNext"
            KeyEvent.KEYCODE_MEDIA_PREVIOUS, KeyEvent.KEYCODE_LAST_CHANNEL -> "MediaTrackPrevious"
            KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_SETTINGS -> "ContextMenu"
            KeyEvent.KEYCODE_INFO, KeyEvent.KEYCODE_TV_DATA_SERVICE -> "i"
            KeyEvent.KEYCODE_GUIDE -> "g"
            KeyEvent.KEYCODE_SEARCH -> "/"
            KeyEvent.KEYCODE_PROG_RED -> "ContextMenu"
            KeyEvent.KEYCODE_PROG_GREEN -> "g"
            KeyEvent.KEYCODE_PROG_YELLOW -> "/"
            KeyEvent.KEYCODE_PROG_BLUE -> "i"
            else -> null
        }
        // Don't steal Back while the on-screen keyboard is typing into a field
        if (key != null) {
            if (event.action == KeyEvent.ACTION_DOWN) sendKey(key)
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    private fun sendKey(key: String) {
        web.evaluateJavascript("window.__auroraKey && window.__auroraKey(${JSONObject.quote(key)})", null)
    }

    private fun emitToWeb(type: String, data: String) {
        runOnUiThread {
            if (isDestroyed) return@runOnUiThread
            web.evaluateJavascript("window.__auroraNative && window.__auroraNative(${JSONObject.quote(type)}, ${JSONObject.quote(data)})", null)
        }
    }

    // ------------------------------------------------------------------ layout of the video surface
    private fun setVideoRect(mode: String, target: Rect) {
        rectAnim?.cancel()
        val lp = playerView.layoutParams as FrameLayout.LayoutParams
        if (mode == "hidden") { playerView.visibility = View.GONE; return }
        val from = if (playerView.visibility == View.VISIBLE && lp.width > 0)
            Rect(lp.leftMargin, lp.topMargin, lp.leftMargin + lp.width, lp.topMargin + lp.height) else null
        playerView.visibility = View.VISIBLE
        if (from == null) { apply(target); return }
        rectAnim = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 380
            interpolator = DecelerateInterpolator(2f)
            addUpdateListener {
                val f = it.animatedValue as Float
                apply(Rect(lerp(from.left, target.left, f), lerp(from.top, target.top, f), lerp(from.right, target.right, f), lerp(from.bottom, target.bottom, f)))
            }
            start()
        }
    }
    private fun lerp(a: Int, b: Int, f: Float) = (a + (b - a) * f).toInt()
    private fun apply(r: Rect) {
        val lp = playerView.layoutParams as FrameLayout.LayoutParams
        lp.leftMargin = r.left; lp.topMargin = r.top; lp.width = maxOf(1, r.width()); lp.height = maxOf(1, r.height())
        playerView.layoutParams = lp
    }

    // ------------------------------------------------------------------ JS bridge
    inner class Bridge {
        @JavascriptInterface fun version(): String = BuildConfig.VERSION_NAME
        @JavascriptInterface fun isTv(): Boolean = packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
        @JavascriptInterface fun play(json: String) = runOnUiThread { player.play(json) }
        @JavascriptInterface fun stop() = runOnUiThread { player.stop() }
        @JavascriptInterface fun pause() = runOnUiThread { player.pause() }
        @JavascriptInterface fun resume() = runOnUiThread { player.resume() }
        @JavascriptInterface fun seek(sec: Double) = runOnUiThread { player.seek(sec) }
        @JavascriptInterface fun setVolume(v: Double) = runOnUiThread { player.setVolume(v.toFloat()) }
        @JavascriptInterface fun setResize(mode: String) = runOnUiThread { player.setResize(mode) }
        @JavascriptInterface fun selectTrack(type: String, id: String) = runOnUiThread { player.selectTrack(type, id) }
        @JavascriptInterface fun getTracks(): String = player.tracksJson
        @JavascriptInterface fun getStats(): String = player.statsJson

        /** Rect in CSS px; vw is the page's innerWidth so we can convert to device px exactly. */
        @JavascriptInterface fun setRect(mode: String, x: Double, y: Double, w: Double, h: Double, vw: Double) = runOnUiThread {
            val s = if (vw > 0) web.width / vw else resources.displayMetrics.density.toDouble()
            val r = if (mode == "full") Rect(0, 0, root.width, root.height)
            else Rect((x * s).toInt(), (y * s).toInt(), ((x + w) * s).toInt(), ((y + h) * s).toInt())
            setVideoRect(mode, r)
        }

        @JavascriptInterface fun exit() = runOnUiThread { player.stop(); finish() }
        /** The page tells us when a text field has focus (OK must then open the keyboard). */
        @JavascriptInterface fun setTextFocus(on: Boolean) { textFocus = on }

        // ---- in-app updates
        @JavascriptInterface fun appVersion(): String = updater.currentVersion().toString()
        @JavascriptInterface fun canInstall(): Boolean = updater.canInstall()
        @JavascriptInterface fun openInstallPermission() = runOnUiThread { updater.openInstallPermission() }
        @JavascriptInterface fun installUpdate(url: String) = updater.install(url)

        /** Saves a text file (backup export) to Downloads; returns a human-readable location. */
        @JavascriptInterface fun saveFile(name: String, content: String): String = try {
            if (Build.VERSION.SDK_INT >= 29) {
                val cv = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, name)
                    put(MediaStore.Downloads.MIME_TYPE, "application/json")
                }
                val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv)!!
                contentResolver.openOutputStream(uri)!!.use { it.write(content.toByteArray()) }
                "Downloads/$name"
            } else {
                val dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: filesDir
                File(dir, name).writeText(content); File(dir, name).absolutePath
            }
        } catch (e: Exception) { "" }
    }

    // ------------------------------------------------------------------ lifecycle
    private fun goImmersive() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }
    override fun onWindowFocusChanged(hasFocus: Boolean) { super.onWindowFocusChanged(hasFocus); if (hasFocus) goImmersive() }
    override fun onPause() { super.onPause(); player.pause(); web.onPause() }
    override fun onResume() { super.onResume(); web.onResume(); emitToWeb("resume", "") }
    override fun onSaveInstanceState(outState: Bundle) { super.onSaveInstanceState(outState); web.saveState(outState) }
    override fun onDestroy() { player.release(); web.destroy(); super.onDestroy() }

    private fun checkWebViewVersion() {
        val pkg = WebViewCompat.getCurrentWebViewPackage(this) ?: return
        val major = pkg.versionName?.substringBefore('.')?.toIntOrNull() ?: return
        if (major < 90) {
            AlertDialog.Builder(this)
                .setTitle("Update Android System WebView")
                .setMessage("Lumora TV needs a newer Android System WebView (installed: ${pkg.versionName}). Update it from the Play Store / App Store for the best experience.")
                .setPositiveButton("OK", null)
                .show()
        }
    }
}
