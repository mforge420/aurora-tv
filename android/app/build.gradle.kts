import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Optional release signing: create android/keystore.properties with
// storeFile=..., storePassword=..., keyAlias=..., keyPassword=...
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "tv.aurora.player"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.lumoratv.player"
        minSdk = 24
        targetSdk = 35
        versionCode = 26
        versionName = "1.0.25"
    }

    signingConfigs {
        // Fixed debug key kept in the repo so sideloaded updates always install over the previous version
        getByName("debug") {
            storeFile = file("debug.keystore")
            storePassword = "android"; keyAlias = "androiddebugkey"; keyPassword = "android"
        }
        if (keystoreProps.isNotEmpty()) create("release") {
            storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
            storePassword = keystoreProps.getProperty("storePassword")
            keyAlias = keystoreProps.getProperty("keyAlias")
            keyPassword = keystoreProps.getProperty("keyPassword")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true }
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/webassets"))
}

// Bundle the web UI (../public) plus the player libraries into the APK assets.
val syncWebAssets by tasks.registering(Sync::class) {
    val repo = rootProject.projectDir.parentFile
    from(File(repo, "public")) { into("www") }
    from(File(repo, "node_modules/hls.js/dist/hls.min.js")) { into("www/vendor") }
    from(File(repo, "node_modules/mpegts.js/dist/mpegts.js")) { into("www/vendor") }
    from(File(repo, "node_modules/qrcode-generator/qrcode.js")) { into("www/vendor") }
    into(layout.buildDirectory.dir("generated/webassets"))
    doFirst {
        require(File(repo, "node_modules/hls.js").exists()) { "Run `npm install` in ${repo} first" }
    }
}
tasks.named("preBuild") { dependsOn(syncWebAssets) }

dependencies {
    val media3 = "1.5.1"
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-exoplayer-hls:$media3")
    implementation("androidx.media3:media3-datasource-okhttp:$media3")
    implementation("androidx.media3:media3-ui:$media3")
    // Software audio decoders (MP2, AC3, E-AC3, DTS, TrueHD…) for boxes that lack them in hardware
    implementation("org.jellyfin.media3:media3-ffmpeg-decoder:1.5.0+1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}

// ./gradlew publishApk → builds, copies the APK to android/LumoraTV-1.0.0.apk (the
// stable download URL / Downloader code) and writes android/version.json, which the
// installed app checks for in-app updates. Commit + push both files to release.
val publishApk by tasks.registering {
    dependsOn("assembleDebug")
    doLast {
        val apk = layout.buildDirectory.file("outputs/apk/debug/app-debug.apk").get().asFile
        apk.copyTo(rootProject.file("LumoraTV-1.0.0.apk"), overwrite = true)
        val notes = rootProject.file("release-notes.txt").takeIf { it.exists() }
            ?.readLines()?.map { it.trim().removePrefix("- ") }?.filter { it.isNotEmpty() } ?: emptyList()
        val json = groovy.json.JsonOutput.toJson(mapOf(
            "versionCode" to android.defaultConfig.versionCode,
            "versionName" to android.defaultConfig.versionName,
            "url" to "https://github.com/mforge420/aurora-tv/raw/main/android/LumoraTV-1.0.0.apk",
            "notes" to notes,
        ))
        rootProject.file("version.json").writeText(groovy.json.JsonOutput.prettyPrint(json) + "\n")
        println("Published ${android.defaultConfig.versionName} (${android.defaultConfig.versionCode})")
    }
}
