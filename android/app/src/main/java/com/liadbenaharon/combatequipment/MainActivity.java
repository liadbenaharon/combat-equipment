package com.liadbenaharon.combatequipment;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewTreeObserver;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

public final class MainActivity extends Activity {
    private static final String START_URL = "https://liadbenaharon.github.io/combat-equipment/";
    private static final String APP_HOST = "liadbenaharon.github.io";
    private static final String APP_PATH = "/combat-equipment/";
    private static final String SUPABASE_HOST = "rryvwztjrbvsczyamrtu.supabase.co";
    private static final String ASSET_ROOT = "www/";
    private static final int PICK_FILE_REQUEST = 1401;
    private static final int SAVE_FILE_REQUEST = 1402;
    private static final long SPLASH_TIMEOUT_MS = 2500;

    private WebView webView;
    private ValueCallback<Uri[]> filePickerCallback;
    private String pendingFile;
    private String pendingMimeType;
    private boolean contentReady;
    private View rootView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        int background = getColor(R.color.app_background);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(background);
        webView = new WebView(this);
        webView.setBackgroundColor(background);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        rootView = root;

        applySystemBars(root, background);
        holdSplashUntilReady(root);
        configureWebView();
        registerBackHandler();

        if (savedInstanceState == null) {
            loadIntentOrHome(getIntent());
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    /** Draws edge to edge and keeps content clear of the status bar, navigation bar and keyboard. */
    private void applySystemBars(FrameLayout root, int background) {
        getWindow().setStatusBarColor(background);
        getWindow().setNavigationBarColor(background);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return WindowInsets.CONSUMED;
            });
        }
    }

    /** Keeps the launch splash screen visible until the app has rendered, instead of showing a blank page. */
    private void holdSplashUntilReady(View root) {
        new Handler(Looper.getMainLooper()).postDelayed(this::markReady, SPLASH_TIMEOUT_MS);
        root.getViewTreeObserver().addOnPreDrawListener(new ViewTreeObserver.OnPreDrawListener() {
            @Override
            public boolean onPreDraw() {
                if (!contentReady) return false;
                root.getViewTreeObserver().removeOnPreDrawListener(this);
                return true;
            }
        });
    }

    private void markReady() {
        if (contentReady) return;
        contentReady = true;
        if (rootView != null) rootView.invalidate();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setSupportMultipleWindows(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        settings.setUserAgentString(settings.getUserAgentString() + " CombatEquipmentAndroid/" + appVersion());

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);
        webView.addJavascriptInterface(new NativeBridge(), "CombatAndroid");

        // A service worker installed by an older version must also receive the bundled files.
        ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                return bundledResponse(request);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePickerCallback != null) filePickerCallback.onReceiveValue(null);
                filePickerCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                try {
                    startActivityForResult(intent, PICK_FILE_REQUEST);
                    return true;
                } catch (ActivityNotFoundException error) {
                    filePickerCallback = null;
                    return false;
                }
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleNavigation(request.getUrl());
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return bundledResponse(request);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                markReady();
                // The app shell is the root screen: back from it leaves the app instead of replaying old pages.
                Uri uri = Uri.parse(url);
                if (isAppUri(uri) && (APP_PATH.equals(uri.getPath()) || (APP_PATH + "index.html").equals(uri.getPath()))) {
                    view.clearHistory();
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    markReady();
                    Toast.makeText(MainActivity.this, R.string.loading_error, Toast.LENGTH_LONG).show();
                }
            }
        });
    }

    private boolean isAppUri(Uri uri) {
        String path = uri.getPath() == null ? "" : uri.getPath();
        return "https".equalsIgnoreCase(uri.getScheme()) && APP_HOST.equalsIgnoreCase(uri.getHost())
                && (path.startsWith(APP_PATH) || path.equals(APP_PATH.substring(0, APP_PATH.length() - 1)));
    }

    /**
     * Serves the app from the files packaged in the APK. The pages keep their original
     * https://liadbenaharon.github.io origin, so data saved by earlier versions stays available
     * and Google sign-in keeps returning to the same address.
     */
    private WebResourceResponse bundledResponse(WebResourceRequest request) {
        if (!"GET".equalsIgnoreCase(request.getMethod())) return null;
        Uri uri = request.getUrl();
        if (!isAppUri(uri)) return null;
        String path = uri.getPath() == null ? APP_PATH : uri.getPath();
        String relative = path.length() > APP_PATH.length() ? path.substring(APP_PATH.length()) : "";
        if (relative.isEmpty() || relative.endsWith("/")) relative += "index.html";
        if (relative.contains("..")) return null;
        AssetManager assets = getAssets();
        InputStream stream;
        try {
            stream = assets.open(ASSET_ROOT + relative);
        } catch (IOException missing) {
            return null; // Not packaged: fall back to the network.
        }
        String mime = mimeType(relative);
        boolean text = mime.startsWith("text/") || mime.endsWith("javascript") || mime.endsWith("json")
                || mime.endsWith("+xml") || mime.equals("application/manifest+json");
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-cache");
        return new WebResourceResponse(mime, text ? "UTF-8" : null, 200, "OK", headers, stream);
    }

    private static String mimeType(String name) {
        String lower = name.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".js")) return "text/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".webmanifest")) return "application/manifest+json";
        return "application/octet-stream";
    }

    private String appVersion() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException error) {
            return "unknown";
        }
    }

    private final class NativeBridge {
        @JavascriptInterface
        public String platform() {
            return "android";
        }

        @JavascriptInterface
        public String version() {
            return appVersion();
        }

        @JavascriptInterface
        public void saveBackup(String contents, String filename) {
            saveFile(contents, filename, "application/json");
        }

        @JavascriptInterface
        public void saveFile(String contents, String filename, String mimeType) {
            runOnUiThread(() -> {
                pendingFile = contents;
                pendingMimeType = mimeType == null || mimeType.isEmpty() ? "application/octet-stream" : mimeType;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(pendingMimeType);
                intent.putExtra(Intent.EXTRA_TITLE, filename);
                try {
                    startActivityForResult(intent, SAVE_FILE_REQUEST);
                } catch (ActivityNotFoundException error) {
                    pendingFile = null;
                    pendingMimeType = null;
                    Toast.makeText(MainActivity.this, R.string.loading_error, Toast.LENGTH_SHORT).show();
                }
            });
        }
    }

    private boolean handleNavigation(Uri uri) {
        String scheme = uri.getScheme();
        String host = uri.getHost();

        if ("https".equalsIgnoreCase(scheme)) {
            if (isAppUri(uri) || SUPABASE_HOST.equalsIgnoreCase(host)) {
                return false;
            }
            openExternal(uri);
            return true;
        }
        if ("intent".equalsIgnoreCase(scheme)) {
            try {
                startActivity(Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME));
            } catch (Exception ignored) {
                Toast.makeText(this, R.string.loading_error, Toast.LENGTH_SHORT).show();
            }
            return true;
        }
        openExternal(uri);
        return true;
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
            Toast.makeText(this, R.string.loading_error, Toast.LENGTH_SHORT).show();
        }
    }

    private void loadIntentOrHome(Intent intent) {
        Uri uri = intent == null ? null : intent.getData();
        if (uri != null && isAppUri(uri)) {
            webView.loadUrl(uri.toString());
        } else {
            webView.loadUrl(START_URL);
        }
    }

    /** Back closes an open dialog or returns to the main tab before leaving the app, like a native app. */
    private void registerBackHandler() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
    }

    private void handleBack() {
        webView.evaluateJavascript(
                "(function(){try{return !!(window.combatNativeBack&&window.combatNativeBack())}catch(e){return false}})()",
                handled -> {
                    if ("true".equals(handled)) return;
                    if (webView.canGoBack()) {
                        webView.goBack();
                    } else {
                        finish();
                    }
                });
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        handleBack();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        loadIntentOrHome(intent);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_FILE_REQUEST) {
            Uri[] result = resultCode == RESULT_OK && data != null && data.getData() != null
                    ? new Uri[]{data.getData()} : null;
            if (filePickerCallback != null) filePickerCallback.onReceiveValue(result);
            filePickerCallback = null;
            return;
        }
        if (requestCode == SAVE_FILE_REQUEST) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingFile != null) {
                try (OutputStream stream = getContentResolver().openOutputStream(data.getData())) {
                    if (stream != null) stream.write(pendingFile.getBytes(StandardCharsets.UTF_8));
                } catch (Exception error) {
                    Toast.makeText(this, R.string.loading_error, Toast.LENGTH_LONG).show();
                }
            }
            pendingFile = null;
            pendingMimeType = null;
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override
    protected void onPause() {
        webView.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }
}
