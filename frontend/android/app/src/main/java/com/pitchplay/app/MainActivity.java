package com.pitchplay.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Message;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Capacitor's stock WebChromeClient does not implement onCreateWindow, so
        // window.open(...) popups from the web app (e.g. the WhatsApp share button)
        // are silently dropped. Replace it with a subclass that forwards any popup
        // URL to the corresponding external app / browser.
        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().setWebChromeClient(new PopupWebChromeClient(this.bridge));
        }
    }

    private static class PopupWebChromeClient extends BridgeWebChromeClient {

        PopupWebChromeClient(Bridge bridge) {
            super(bridge);
        }

        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            if (resultMsg == null || !(resultMsg.obj instanceof WebView.WebViewTransport)) {
                return false;
            }

            // Temp WebView that simply hands the popup's URL to the system.
            WebView popup = new WebView(view.getContext());
            popup.setWebViewClient(
                new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView popupView, WebResourceRequest request) {
                        openExternally(popupView, request.getUrl());
                        return true;
                    }

                    @SuppressWarnings("deprecation")
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView popupView, String url) {
                        openExternally(popupView, Uri.parse(url));
                        return true;
                    }
                }
            );

            WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
            transport.setWebView(popup);
            resultMsg.sendToTarget();
            return true;
        }

        private static void openExternally(WebView source, Uri uri) {
            if (uri == null) {
                return;
            }
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                source.getContext().startActivity(intent);
            } catch (Exception e) {
                // No app on the device can handle this URL; nothing else we can do.
            }
        }
    }
}
