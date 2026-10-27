package com.prolawnmower.InkPod;

import android.annotation.SuppressLint;
import android.app.Dialog;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Message;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {

    private Dialog popupDialog;
    private WebView popupWebView;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocalMusicPlugin.class);
        super.onCreate(savedInstanceState);
        setupWebView();
        // 播放器语义：前台期间保持屏幕常亮
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    // 沉浸全屏：隐藏系统状态栏/导航栏（IMMERSIVE_STICKY：从边缘滑入短暂显示后自动隐藏）
    private void applyImmersive() {
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyImmersive();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        Bridge bridge = getBridge();
        if (bridge == null) return;
        WebView webView = bridge.getWebView();

        WebSettings s = webView.getSettings();
        // MusicKit OAuth 使用 window.open 弹窗 + postMessage 回传
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);

        // Apple 登录 SSO 依赖 apple.com 域 Cookie
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(webView, true);

        // 本地音乐流式转发：拦截 https://localhost/local-music/<encoded-uri>
        webView.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse local = LocalMusicStream.tryIntercept(getApplicationContext(), request);
                if (local != null) return local;
                return super.shouldInterceptRequest(view, request);
            }
        });

        // OAuth 弹窗承载：onCreateWindow 建对话框 WebView（与主 WebView 同进程，window.opener/postMessage 可用）
        webView.setWebChromeClient(new BridgeWebChromeClient(bridge) {
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                return openPopupWindow(view, resultMsg);
            }

            @Override
            public void onCloseWindow(WebView window) {
                if (window == popupWebView) dismissPopup();
                super.onCloseWindow(window);
            }
        });
    }

    @SuppressLint("SetJavaScriptEnabled")
    private boolean openPopupWindow(WebView parent, Message resultMsg) {
        dismissPopup();

        popupWebView = new WebView(parent.getContext());
        WebSettings ps = popupWebView.getSettings();
        ps.setJavaScriptEnabled(true);
        ps.setDomStorageEnabled(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(popupWebView, true);

        popupWebView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false; // 弹窗内直接加载（含 apple.com 重定向）
            }
        });
        popupWebView.setWebChromeClient(new WebChromeClient());

        FrameLayout container = new FrameLayout(this);
        container.setBackgroundColor(Color.WHITE);
        container.addView(popupWebView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        popupDialog = new Dialog(this, android.R.style.Theme_Black_NoTitleBar);
        Window w = popupDialog.getWindow();
        if (w != null) {
            w.setGravity(Gravity.CENTER);
            w.setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT);
        }
        popupDialog.setContentView(container);
        popupDialog.setOnCancelListener(d -> dismissPopup());
        popupDialog.show();

        WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
        transport.setWebView(popupWebView);
        resultMsg.sendToTarget();
        return true;
    }

    private void dismissPopup() {
        if (popupDialog != null) {
            try { popupDialog.dismiss(); } catch (Exception ignored) {}
            popupDialog = null;
        }
        if (popupWebView != null) {
            try { popupWebView.destroy(); } catch (Exception ignored) {}
            popupWebView = null;
        }
    }

    @Override
    public void onDestroy() {
        dismissPopup();
        super.onDestroy();
    }
}
