package tv.aurora.player

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import androidx.core.content.pm.PackageInfoCompat
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import kotlin.concurrent.thread

/** Downloads a newer APK and hands it to the system package installer. */
class Updater(private val activity: Activity, private val emit: (String) -> Unit) {

    @Volatile private var busy = false

    fun currentVersion(): JSONObject {
        val pi = activity.packageManager.getPackageInfo(activity.packageName, 0)
        return JSONObject().put("code", PackageInfoCompat.getLongVersionCode(pi)).put("name", pi.versionName)
    }

    /** Android 8+ requires the user to allow this app to install packages. */
    fun canInstall(): Boolean =
        Build.VERSION.SDK_INT < 26 || activity.packageManager.canRequestPackageInstalls()

    fun openInstallPermission() {
        if (Build.VERSION.SDK_INT < 26) return
        val i = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}"))
        runCatching { activity.startActivity(i) }.onFailure {
            // Some TV builds (e.g. older Fire OS) don't have the per-app screen
            runCatching { activity.startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS)) }
        }
    }

    fun install(url: String) {
        if (busy) return
        busy = true
        thread(name = "updater") {
            try {
                val dir = File(activity.cacheDir, "updates").apply { mkdirs() }
                dir.listFiles()?.forEach { it.delete() }
                val file = File(dir, "lumora-update.apk")
                val resp = LocalServer.http.newCall(Request.Builder().url(url).build()).execute()
                if (!resp.isSuccessful) throw Exception("Download failed (HTTP ${resp.code})")
                val body = resp.body ?: throw Exception("Empty download")
                val total = body.contentLength()
                var done = 0L; var lastPct = -1
                body.byteStream().use { input ->
                    file.outputStream().use { out ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            val n = input.read(buf); if (n < 0) break
                            out.write(buf, 0, n); done += n
                            val pct = if (total > 0) (done * 100 / total).toInt() else -1
                            if (pct != lastPct) { lastPct = pct; state("downloading", pct) }
                        }
                    }
                }
                // Sanity-check before handing it to the installer
                val info = activity.packageManager.getPackageArchiveInfo(file.path, 0)
                    ?: throw Exception("The downloaded file is not a valid app")
                if (info.packageName != activity.packageName) throw Exception("The download is a different app (${info.packageName})")
                val cur = PackageInfoCompat.getLongVersionCode(activity.packageManager.getPackageInfo(activity.packageName, 0))
                if (PackageInfoCompat.getLongVersionCode(info) <= cur) throw Exception("You already have this version")

                val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.files", file)
                val intent = Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                activity.runOnUiThread { activity.startActivity(intent) }
                state("installing", 100)
            } catch (e: Exception) {
                emit(JSONObject().put("state", "error").put("message", e.message ?: "Update failed").toString())
            } finally {
                busy = false
            }
        }
    }

    private fun state(s: String, pct: Int) = emit(JSONObject().put("state", s).put("pct", pct).toString())
}
