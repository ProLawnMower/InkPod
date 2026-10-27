package com.prolawnmower.InkPod;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * 本地音乐流式转发：
 * WebView 里 <audio>/XHR 请求 https://localhost/local-music/<urlencoded 路径>
 * 时返回整个文件（200 全量流）。
 *
 * 背景：该设备的 Chromium 83 WebView 对 shouldInterceptRequest 返回的 206/Content-Range
 * 支持残缺（仅接受偏移 0 的 206，Range 支持在 Chromium 93 才补齐），因此这里忽略
 * Range 一律以 200 返回全量流，由 Chromium 自身的缓冲/缓存满足媒体播放的局部读取。
 * 标签解析不走此通道（XHR 拉全量文件代价过高），由插件的 readHead 在 Java 端切片。
 */
public final class LocalMusicStream {

    public static final String PATH_PREFIX = "/local-music/";

    private LocalMusicStream() {}

    public static WebResourceResponse tryIntercept(Context ctx, WebResourceRequest request) {
        Uri url = request.getUrl();
        if (url == null) return null;
        String host = url.getHost();
        String path = url.getPath();
        if (host == null || path == null || !path.startsWith(PATH_PREFIX)) return null;

        String encoded = path.substring(PATH_PREFIX.length());
        if (encoded.isEmpty()) return notFound();
        String decoded;
        try {
            decoded = Uri.decode(encoded);
        } catch (Exception e) {
            return notFound();
        }

        InputStream in = null;
        long fullLength = 0;
        if (decoded.startsWith("/")) {
            File file = new File(decoded);
            if (!file.isFile()) return notFound();
            fullLength = file.length();
            try { in = new FileInputStream(file); } catch (Exception e) { return notFound(); }
        } else if (decoded.startsWith("content:")) {
            try {
                android.content.res.AssetFileDescriptor afd =
                        ctx.getContentResolver().openAssetFileDescriptor(Uri.parse(decoded), "r");
                if (afd == null) return notFound();
                fullLength = afd.getLength();
                in = afd.createInputStream();
            } catch (Exception e) { return notFound(); }
        } else {
            return notFound();
        }

        if ("HEAD".equalsIgnoreCase(request.getMethod())) {
            if (in != null) { try { in.close(); } catch (Exception ignored) {} }
            Map<String, String> head = new HashMap<>();
            head.put("Accept-Ranges", "bytes");
            head.put("Access-Control-Allow-Origin", "*");
            return new WebResourceResponse(guessMime(decoded), null, 200, "OK",
                    head, new java.io.ByteArrayInputStream(new byte[0]));
        }

        Map<String, String> headers = new HashMap<>();
        headers.put("Accept-Ranges", "none");
        headers.put("Access-Control-Allow-Origin", "*");
        if (fullLength > 0) headers.put("X-Content-Length", String.valueOf(fullLength));
        return new WebResourceResponse(guessMime(decoded), null, 200, "OK", headers, in);
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", null, 404, "Not Found", null, null);
    }

    static String guessMime(String path) {
        String name = path.toLowerCase(Locale.US);
        String[] parts = name.split("/");
        name = parts[parts.length - 1];
        int dot = name.lastIndexOf('.');
        String ext = dot < 0 ? "" : name.substring(dot + 1);
        switch (ext) {
            case "mp3": return "audio/mpeg";
            case "m4a":
            case "m4b":
            case "mp4": return "audio/mp4";
            case "aac": return "audio/aac";
            case "flac": return "audio/flac";
            case "ogg":
            case "oga":
            case "opus": return "audio/ogg";
            case "wav": return "audio/wav";
            case "wma": return "audio/x-ms-wma";
            case "aiff":
            case "aif": return "audio/aiff";
            default: return "application/octet-stream";
        }
    }
}
