package tv.aurora.player

import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.security.SecureRandom
import java.util.concurrent.Executors
import kotlin.concurrent.thread

/**
 * "Add from phone": a tiny LAN-only web server that runs only while the TV shows
 * the QR code. The phone page posts the playlist details, protected by a one-time PIN.
 * Pure JVM code (no Android APIs) so it can be unit-tested off-device.
 */
class RemoteServer(
    private val asset: (String) -> ByteArray?,   // loads bundled page files
    private val onAdd: (JSONObject) -> Unit,      // forwards a submitted playlist to the UI
) {
    @Volatile var pin: String = ""; private set
    @Volatile var port: Int = 0; private set
    @Volatile var lastResult: String = """{"state":"waiting"}"""
    private var socket: ServerSocket? = null
    private val pool = Executors.newCachedThreadPool()
    private var failedPins = 0

    val running get() = socket?.isClosed == false

    /** Starts (or keeps) the server; returns the port, or -1. */
    @Synchronized fun start(): Int {
        if (running) return port
        pin = (1000 + SecureRandom().nextInt(9000)).toString()
        failedPins = 0
        lastResult = """{"state":"waiting"}"""
        for (p in listOf(8686, 8687, 8688, 8689, 0)) {
            try {
                val s = ServerSocket()
                s.reuseAddress = true
                s.bind(InetSocketAddress(p))
                socket = s; port = s.localPort
                break
            } catch (_: Exception) { }
        }
        val s = socket ?: return -1
        thread(name = "remote-accept", isDaemon = true) {
            while (!s.isClosed) {
                val c = try { s.accept() } catch (_: Exception) { break }
                pool.execute { handle(c) }
            }
        }
        return port
    }

    @Synchronized fun stop() { try { socket?.close() } catch (_: Exception) { }; socket = null }

    private fun handle(c: Socket) = c.use { sock ->
        try {
            sock.soTimeout = 10_000
            val input = BufferedInputStream(sock.getInputStream())
            val head = readHead(input) ?: return
            val lines = head.split("\r\n")
            val (method, rawPath) = lines[0].split(" ").let { (it.getOrNull(0) ?: "") to (it.getOrNull(1) ?: "/") }
            val headers = lines.drop(1).mapNotNull { l -> l.indexOf(':').takeIf { it > 0 }?.let { l.substring(0, it).trim().lowercase() to l.substring(it + 1).trim() } }.toMap()
            val path = rawPath.substringBefore('?')
            val len = headers["content-length"]?.toIntOrNull() ?: 0
            if (len > 64 * 1024) return respond(sock, 413, "application/json", """{"error":"too large"}""".toByteArray())
            val body = if (len > 0) readN(input, len) else ByteArray(0)
            when {
                method == "GET" && (path == "/" || path == "/index.html") ->
                    respond(sock, 200, "text/html; charset=utf-8", asset("remote.html") ?: "Missing page".toByteArray())
                method == "GET" && path == "/icon.svg" ->
                    respond(sock, 200, "image/svg+xml", asset("icons/icon.svg") ?: ByteArray(0))
                method == "GET" && path == "/status" -> respond(sock, 200, "application/json", lastResult.toByteArray())
                method == "POST" && path == "/add" -> {
                    val j = try { JSONObject(String(body, Charsets.UTF_8)) } catch (e: Exception) { null }
                    when {
                        j == null -> respond(sock, 400, "application/json", """{"error":"Invalid request"}""".toByteArray())
                        failedPins >= 10 -> respond(sock, 429, "application/json", """{"error":"Too many wrong codes. Reopen 'From phone' on the TV."}""".toByteArray())
                        j.optString("pin") != pin -> { failedPins++; respond(sock, 403, "application/json", """{"error":"Wrong code. Check the 4-digit code on the TV."}""".toByteArray()) }
                        else -> {
                            j.remove("pin")
                            lastResult = """{"state":"adding"}"""
                            onAdd(j)
                            respond(sock, 200, "application/json", """{"ok":true}""".toByteArray())
                        }
                    }
                }
                else -> respond(sock, 404, "text/plain", "Not found".toByteArray())
            }
        } catch (_: SocketTimeoutException) { } catch (_: Exception) { }
    }

    private fun readHead(input: InputStream): String? {
        val buf = ByteArrayOutputStream()
        var last4 = 0
        while (true) {
            val b = input.read()
            if (b < 0) return null
            buf.write(b)
            last4 = (last4 shl 8) or b
            if (last4 == 0x0D0A0D0A) return String(buf.toByteArray(), Charsets.ISO_8859_1).trimEnd()
            if (buf.size() > 16 * 1024) return null
        }
    }
    private fun readN(input: InputStream, n: Int): ByteArray {
        val out = ByteArray(n); var off = 0
        while (off < n) { val r = input.read(out, off, n - off); if (r < 0) break; off += r }
        return out.copyOf(off)
    }
    private fun respond(s: Socket, code: Int, type: String, body: ByteArray) {
        val reason = mapOf(200 to "OK", 400 to "Bad Request", 403 to "Forbidden", 404 to "Not Found", 413 to "Payload Too Large", 429 to "Too Many Requests")[code] ?: "OK"
        val head = "HTTP/1.1 $code $reason\r\nContent-Type: $type\r\nContent-Length: ${body.size}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
        s.getOutputStream().apply { write(head.toByteArray()); write(body); flush() }
    }

    companion object {
        /** The TV's address on the home network (Wi-Fi or Ethernet). */
        fun lanAddress(): String? = try {
            NetworkInterface.getNetworkInterfaces().toList()
                .filter { it.isUp && !it.isLoopback && !it.isVirtual }
                .sortedBy { n -> if (n.name.startsWith("eth")) 0 else if (n.name.startsWith("wlan")) 1 else 2 }
                .flatMap { it.inetAddresses.toList() }
                .filterIsInstance<Inet4Address>()
                .let { all -> (all.firstOrNull { it.isSiteLocalAddress } ?: all.firstOrNull { !it.isLinkLocalAddress && !it.isLoopbackAddress })?.hostAddress }
        } catch (_: Exception) { null }
    }
}
