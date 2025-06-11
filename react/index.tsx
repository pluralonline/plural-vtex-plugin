import axios from "axios";
import React, { Component } from "react";
import { account, appName, majorVersion } from "./constants";
import "./styles.css";
import { PLURAL } from "./constants";

type Props = {
  appPayload: any;
};

const css = `
#plural-iframe {
  height: 100% !important;
  border: none;
}

#plural-modal {
  margin: 0;
  border: none;
  border-radius: 0;
}
`;

const injectScript = (id: string, src: string, onLoad: any) => {
  if (document.getElementById(id)) return;

  const head = document.getElementsByTagName("head")[0];
  const js = document.createElement("script");
  js.id = id;
  js.src = src;
  js.async = true;
  js.defer = true;
  js.onload = onLoad;
  head.appendChild(js);
};

const injectStyle = () => {
  const head = document.getElementsByTagName("head")[0];
  const tag = document.createElement("style");
  tag.innerHTML = css;
  head.appendChild(tag);
};

export default class PinelabsApp extends Component<Props> {
  componentDidMount() {
    const parsedPayload = JSON.parse(this.props.appPayload);

    if (parsedPayload.data.redirect_url) {
      this.setupPluralCheckout(parsedPayload.data.redirect_url);
      return;
    }

    injectScript(
      "plural-checkout-script",
      parsedPayload.data.redirect_url ?? PLURAL.SCRIPT_URL_PROD,
      this.handleOnLoad
    );
    injectStyle();
  }

  setupPluralCheckout = (redirectUrl: string) => {
    injectScript(
      "plural-checkout-script",
      PLURAL.SCRIPT_URL_PROD,
      () => this.handlePluralSdkLoad(redirectUrl)
    );
    injectStyle();
  };

  handlePluralSdkLoad = (redirectUrl: string) => {
    const options = {
      redirectUrl: redirectUrl,
      successHandler: this.successHandler,
      failedHandler: this.failedHandler,
    };

    // @ts-ignore
    const plural = new Plural(options);
    plural.open(options);
    $(window).trigger("removePaymentLoading.vtex");
  };

  handleOnLoad = async () => {
    let parsedPayload = JSON.parse(this.props.appPayload);

    const options = {
      theme: "default",
      orderToken: parsedPayload.data.token,
      channelId: "WEB",
      paymentMode: "CREDIT_DEBIT,NETBANKING,UPI,WALLET,EMI,DEBIT_EMI",
      showSavedCardsFeature: false,
      successHandler: this.successHandler,
      failedHandler: this.failedHandler,
    };

    // @ts-ignore
    const plural = new Plural(options);
    plural.open(options);
    $(window).trigger("removePaymentLoading.vtex");
  };

  successHandler = async (response: any) => {
    let parsedPayload = JSON.parse(this.props.appPayload);
    console.log("Success handler called with response:", response);
    
    axios
      .post(`/_v/${account}.${appName}/v${majorVersion}/paymentStatus`, {
        ...response,
        callbackUrl: parsedPayload.data.callbackUrl,
      })
      .then((res) => {
        console.log("Payment status API response:", res.data);
        
        if(res.data.data?.status === "ORDER_ATTEMPTED"){
          console.log("Payment in ORDER_ATTEMPTED state, waiting for confirmation");
          return;
        }
        
        // CRITICAL FIX: Change [false] to [true] for successful payments!
        $(window).trigger("transactionValidation.vtex", [true]);
        
        // Also send the approved message to parent window
        if (window.parent) {
          window.parent.postMessage({ name: 'checkout:payment-authorization', status: 'approved' }, '*');
        }
        
        console.log("Payment approved, redirection should occur automatically");
        
        // Check if we have a redirectUrl in the response and use it
        if (res.data.redirectUrl) {
          console.log("Redirecting to:", res.data.redirectUrl);
          setTimeout(() => {
            window.top.location.href = res.data.redirectUrl;
          }, 1000);
        }
      })
      .catch((error) => {
        console.error("Payment status update failed:", error);
        $(window).trigger("transactionValidation.vtex", [false]);
      });
  };
  

  failedHandler = async (response: any) => {
    if (!response.plural_order_id) return;

    let parsedPayload = JSON.parse(this.props.appPayload);
    try {
      const res = await axios.post(
        `/_v/${account}.${appName}/v${majorVersion}/paymentStatus`,
        {
          ...response,
          callbackUrl: parsedPayload.data.callbackUrl,
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (res.data.data.status === "ORDER_ATTEMPTED") return;

      this.handleRedirectFailure();

    } catch (error) {
      console.error("Payment status update failed:", error);
      this.handleRedirectFailure();
    }
  };

  handleRedirectFailure = () => {
    $(window).trigger("transactionValidation.vtex", [false]);

    const message = { message: "checkout:payment-authorization", status: "denied" };
    if (window.parent !== window) {
      window.parent.postMessage(message, "*");
    } else {
      window.postMessage(message, "*");
    }
  };

  render() {
    return (
      <div>
        <p style={{ textAlign: "center", marginTop: "40px" }}>
          Processing your payment. Please wait...
        </p>
      </div>
    );
  }
}
