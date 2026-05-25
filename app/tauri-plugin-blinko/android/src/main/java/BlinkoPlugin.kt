package com.plugin.blinko

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import app.tauri.plugin.Invoke

@InvokeArg
class SetColorArgs {
  lateinit var hex: String
}

@InvokeArg
class ShareFileArgs {
  lateinit var url: String
  var filename: String? = null
}


@TauriPlugin
class BlinkoPlugin(private val activity: Activity): Plugin(activity) {
    private val implementation = Blinko()

    @Command
    fun setcolor(invoke: Invoke) {
        val args = invoke.parseArgs(SetColorArgs::class.java)
        implementation.setcolor(args.hex, activity)
        invoke.resolve()
    }

    @Command
    fun openAppSettings(invoke: Invoke) {
        implementation.openAppSettings(activity)
        invoke.resolve()
    }

    @Command
    fun shareFile(invoke: Invoke) {
        val args = invoke.parseArgs(ShareFileArgs::class.java)
        implementation.shareFile(args.url, args.filename, activity)
        invoke.resolve()
    }
}
