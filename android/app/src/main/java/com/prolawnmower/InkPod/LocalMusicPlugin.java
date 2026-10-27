package com.prolawnmower.InkPod;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Environment;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * 本地音乐插件（免系统选择器版）：
 * 固定使用 /storage/emulated/0/Music（即 /sdcard/Music）作为曲库根目录。
 *  - pickFolder()：检查目录存在 + 申请读取权限（该 ROM 无 DocumentsUI，不走 SAF）
 *  - listFiles({uri})：File API 递归枚举音频文件，返回 [{id, name, size}]
 *    id = 文件绝对路径（JS 端 encodeURIComponent 后拼流地址）
 * 流式播放由 LocalMusicStream（shouldInterceptRequest）完成。
 */
@CapacitorPlugin(name = "LocalMusic")
public class LocalMusicPlugin extends Plugin {

    private PluginCall pendingPermissionCall;
    private ActivityResultLauncher<String> permissionLauncher;

    public static String musicRoot() {
        return Environment.getExternalStorageDirectory().getAbsolutePath() + "/Music";
    }

    private static final Set<String> AUDIO_EXT = new HashSet<>();

    static {
        String[] exts = {"mp3", "m4a", "m4b", "aac", "flac", "ogg", "oga", "opus", "wav", "wma", "aiff", "aif"};
        for (String e : exts) AUDIO_EXT.add(e);
    }

    private String requiredPermission() {
        if (Build.VERSION.SDK_INT >= 33) return "android.permission.READ_MEDIA_AUDIO";
        return Manifest.permission.READ_EXTERNAL_STORAGE;
    }

    private boolean hasPermission() {
        return ContextCompat.checkSelfPermission(getContext(), requiredPermission())
                == PackageManager.PERMISSION_GRANTED;
    }

    @PluginMethod
    public void pickFolder(PluginCall call) {
        // 固定目录：无系统选择器的设备也能用
        File dir = new File(musicRoot());
        if (!dir.exists() || !dir.isDirectory()) {
            call.reject("Folder not found: " + musicRoot() + " — put your music there first");
            return;
        }
        if (hasPermission()) {
            resolveFolder(call);
            return;
        }
        pendingPermissionCall = call;
        ensureLauncher().launch(requiredPermission());
    }

    private ActivityResultLauncher<String> ensureLauncher() {
        if (permissionLauncher == null) {
            permissionLauncher = getActivity().registerForActivityResult(
                    new ActivityResultContracts.RequestPermission(),
                    granted -> {
                        PluginCall call = pendingPermissionCall;
                        pendingPermissionCall = null;
                        if (call == null) return;
                        if (granted) resolveFolder(call);
                        else call.reject("Storage permission denied");
                    });
        }
        return permissionLauncher;
    }

    private void resolveFolder(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("uri", musicRoot());
        call.resolve(ret);
    }


    // 读取文件头 N 字节（base64 返回），供 JS 端 jsmediatags 的 BlobFileReader 解析标签。
    // 不走 WebView 的 XHR：该 Chromium 83 对拦截响应的 Range 支持残缺，且整文件传输代价过高。
    @PluginMethod
    public void readHead(PluginCall call) {
        String path = call.getString("uri");
        Integer bytes = call.getInt("bytes");
        if (path == null || path.isEmpty()) { call.reject("Missing uri"); return; }
        int n = bytes != null ? Math.min(bytes, 1048576) : 262144;
        new Thread(() -> {
            try {
                java.io.File f = new java.io.File(path);
                if (!f.isFile()) { call.reject("File not found"); return; }
                int len = (int) Math.min(n, f.length());
                byte[] buf = new byte[len];
                java.io.DataInputStream din = new java.io.DataInputStream(
                        new java.io.BufferedInputStream(new java.io.FileInputStream(f), 65536));
                try { din.readFully(buf); } finally { try { din.close(); } catch (Exception ignored) {} }
                JSObject ret = new JSObject();
                ret.put("base64", android.util.Base64.encodeToString(buf, android.util.Base64.NO_WRAP));
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("readHead failed: " + e.getMessage());
            }
        }, "LocalMusicReadHead").start();
    }

    @PluginMethod
    public void listFiles(PluginCall call) {
        String pathStr = call.getString("uri");
        if (pathStr == null || pathStr.isEmpty()) {
            call.reject("Missing uri parameter");
            return;
        }
        final File root = new File(pathStr);
        new Thread(() -> {
            try {
                if (!root.isDirectory()) {
                    call.reject("Directory not accessible: " + pathStr);
                    return;
                }
                JSArray files = new JSArray();
                Deque<File> queue = new ArrayDeque<>();
                queue.add(root);
                while (!queue.isEmpty()) {
                    File dir = queue.poll();
                    File[] children = dir.listFiles();
                    if (children == null) continue;
                    for (File child : children) {
                        if (child.isDirectory()) {
                            queue.add(child);
                        } else {
                            String name = child.getName();
                            if (isAudio(name)) {
                                JSObject f = new JSObject();
                                f.put("id", child.getAbsolutePath());
                                f.put("name", name);
                                f.put("size", child.length());
                                files.put(f);
                            }
                        }
                    }
                }
                JSObject ret = new JSObject();
                ret.put("files", files);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("List failed: " + e.getMessage());
            }
        }, "LocalMusicList").start();
    }

    private static boolean isAudio(String name) {
        int dot = name.lastIndexOf('.');
        if (dot < 0 || dot == name.length() - 1) return false;
        String ext = name.substring(dot + 1).toLowerCase(Locale.US);
        return AUDIO_EXT.contains(ext);
    }
}
