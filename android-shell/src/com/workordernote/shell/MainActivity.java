package com.workordernote.shell;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * 工作序记 安卓客户端（壳子）。
 *
 * 就是一个全屏 WebView 装网页版，外加两件原生能力：
 *   1) 「服务器地址」设置——登录页上有入口（网页通过 JS 桥 AndroidShell 调起原生弹窗），
 *      首次安装没有地址时也会自动弹一次；地址存在 SharedPreferences 里。
 *   2) 文件选择（网页里的上传按钮）/ 返回键回退 / 外部链接交给系统浏览器。
 *
 * 只用 Android 框架自带的 API，不引 AndroidX：这样本机不装 Gradle 也能用
 * aapt2 + javac + d8 + apksigner 直接编出 APK（见 build-apk.sh）。
 */
public class MainActivity extends Activity {

    private static final String PREFS = "workordernote";
    private static final String KEY_SERVER = "server_url";
    /** 首次安装没填地址时的占位提示；用户改成自己的地址即可。 */
    private static final String SERVER_HINT = "http://127.0.0.1:8906";
    private static final int REQ_FILE_CHOOSER = 1001;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private long lastBackAt = 0L;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

        FrameLayout root = new FrameLayout(this);
        root.setLayoutParams(new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web = new WebView(this);
        web.setLayoutParams(new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.setBackgroundColor(Color.WHITE);
        root.addView(web);
        setContentView(root);

        configureWebView();

        String server = getServer();
        if (server.isEmpty()) {
            showServerDialog(true);
        } else {
            loadApp(server);
        }
    }

    // ---------------- WebView 配置 ----------------

    private void configureWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            // 内网多半是 http，而页面里可能混着 https 资源（或反过来），放行混合内容
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        }
        CookieManager.getInstance().setAcceptCookie(true);
        // UA 上带个标记，网页端想区分「在壳子里」也能用；主要识别手段还是 JS 桥是否存在
        s.setUserAgentString(s.getUserAgentString() + " WorkOrderNoteApp/" + appVersion());

        web.addJavascriptInterface(new ShellBridge(), "AndroidShell");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl().toString());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(url);
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) {
                    fileCallback.onReceiveValue(null);
                }
                fileCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(Intent.createChooser(intent, "选择文件"), REQ_FILE_CHOOSER);
                    return true;
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    toast("没有可用的文件选择器");
                    return false;
                }
            }
        });

        // 网页里的下载（例如「下载安卓客户端」那个 APK）交给系统浏览器/下载器处理，
        // 壳子本身不做下载，免得用户装不上更新。
        web.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (ActivityNotFoundException e) {
                    toast("没有可用的浏览器来打开这个链接");
                }
            }
        });
    }

    /** 同一个服务器（含同域子路径）留在 WebView 里，其它外链交给系统浏览器。 */
    private boolean handleUrl(String url) {
        if (url == null) return false;
        String server = getServer();
        if (server.isEmpty()) return false;
        if (url.startsWith(server) || url.startsWith("about:") || url.startsWith("javascript:")) {
            return false; // 交给 WebView 自己加载
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (ActivityNotFoundException e) {
            toast("没有可用的应用打开这个链接");
        }
        return true;
    }

    // ---------------- 服务器地址 ----------------

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private String getServer() {
        return prefs().getString(KEY_SERVER, "");
    }

    private void loadApp(String server) {
        // 打开根路径而不是 /login：路由守卫会按登录态决定去工作台还是登录页。
        // 原来写死 /login，导致壳子里每次启动都停在登录页（网页端已同时加了
        // 「已登录访问 /login 自动进工作台」，所以旧 APK 不重装也能好）。
        web.loadUrl(server + "/");
    }

    /** 容错：没写协议就补 http://，去掉结尾的斜杠与多余空格。 */
    static String normalizeServer(String raw) {
        String s = raw == null ? "" : raw.trim();
        if (s.isEmpty()) return "";
        if (!s.startsWith("http://") && !s.startsWith("https://")) s = "http://" + s;
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return s;
    }

    /**
     * 「服务器地址」弹窗。首次进入（firstRun=true）时不可取消，必须填一个地址才能用。
     */
    private void showServerDialog(final boolean firstRun) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(20);
        box.setPadding(pad, dp(8), pad, 0);

        TextView tip = new TextView(this);
        tip.setText("填工作序记服务器的地址。内网填 NAS 的地址（例如 http://127.0.0.1:8906），"
                + "在外面用就填外网地址。改完会自动重新加载。");
        tip.setTextSize(13);
        tip.setTextColor(Color.parseColor("#4b5563"));
        box.addView(tip);

        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        input.setSingleLine(true);
        input.setHint(SERVER_HINT);
        String current = getServer();
        input.setText(current.isEmpty() ? SERVER_HINT : current);
        input.setSelection(input.getText().length());
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(12);
        box.addView(input, lp);

        AlertDialog.Builder b = new AlertDialog.Builder(this)
                .setTitle("服务器地址")
                .setView(box)
                .setPositiveButton("保存", (d, w) -> {
                    String server = normalizeServer(input.getText().toString());
                    if (server.isEmpty()) {
                        toast("地址不能为空");
                        showServerDialog(firstRun);
                        return;
                    }
                    prefs().edit().putString(KEY_SERVER, server).apply();
                    web.clearCache(false);
                    loadApp(server);
                });
        if (!firstRun) {
            b.setNegativeButton("取消", null);
        }
        AlertDialog dialog = b.create();
        dialog.setCanceledOnTouchOutside(false);
        dialog.setCancelable(!firstRun);
        dialog.show();
    }

    // ---------------- JS 桥：网页里的「服务器地址」入口 ----------------

    private class ShellBridge {
        @JavascriptInterface
        public String getServerUrl() {
            return getServer();
        }

        @JavascriptInterface
        public String getAppVersion() {
            return appVersion();
        }

        @JavascriptInterface
        public void openServerSettings() {
            runOnUiThread(() -> showServerDialog(false));
        }

        @JavascriptInterface
        public void reload() {
            runOnUiThread(() -> web.reload());
        }
    }

    private String appVersion() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "0";
        }
    }

    // ---------------- 返回键与文件选择 ----------------

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastBackAt < 2000) {
            super.onBackPressed();
        } else {
            lastBackAt = now;
            toast("再按一次退出");
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                fileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private void toast(String msg) {
        Toast t = Toast.makeText(this, msg, Toast.LENGTH_SHORT);
        t.setGravity(Gravity.BOTTOM, 0, dp(80));
        t.show();
    }

    private int dp(int v) {
        return Math.round(getResources().getDisplayMetrics().density * v);
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
