import axios from "axios";
import React, { Component } from "react";
import { account, appName, majorVersion } from "./constants";
import "./styles.css";
import {PLURAL} from "./constants";

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
  if (document.getElementById(id)) {
    return;
  }

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
    let parsedPayload = JSON.parse(this.props.appPayload);
    console.log({parsedPayload})
    injectScript(
      "plural-checkout-script",
      parsedPayload.data.pluralScriptUrl ?? PLURAL.SCRIPT_URL_PROD,
      this.handleOnLoad
    );
    injectStyle();
  }

  handleOnLoad = async () => {
    debugger
    let parsedPayload = JSON.parse(this.props.appPayload);

    const options = {
      theme: "default", // "default" or "black"
      orderToken: parsedPayload.data.token,
      channelId: "WEB", // "APP" or "WEB"
      paymentMode: "CREDIT_DEBIT,NETBANKING,UPI,WALLET,EMI,DEBIT_EMI", // comma separated - Example - 'CREDIT_DEBIT,NETBANKING,UPI,WALLET,EMI,DEBIT_EMI'
      showSavedCardsFeature: false, // type = boolean, default = true
      successHandler: this.successHandler,
      failedHandler: this.failedHandler,
    };

    //@ts-ignore
    const plural = new Plural(options);
    plural.open(options);
    $(window).trigger("removePaymentLoading.vtex");
  };

  successHandler = async (response: any) => {
    let parsedPayload = JSON.parse(this.props.appPayload);
    axios
      .post(`/_v/${account}.${appName}/v${majorVersion}/paymentStatus`, {
        ...response,
        callbackUrl: parsedPayload.data.callbackUrl,
      })
      .then((res) => {
        console.log({res})
        debugger
        if(res.data.data.status  === "ORDER_ATTEMPTED"){
          return
        }
        
        $(window).trigger("transactionValidation.vtex", [false]);
      })
      .catch(() => {
        $(window).trigger("transactionValidation.vtex", [false]);
      });
  };

  failedHandler = async (response: any) => {
    if (!response.plural_order_id) {
      return;
    }

    let parsedPayload = JSON.parse(this.props.appPayload);
    axios
      .post(`/_v/${account}.${appName}/v${majorVersion}/paymentStatus`, {
        ...response,
        callbackUrl: parsedPayload.data.callbackUrl,
      })
      .then((res) => {
        if(res.data.data.status  === "ORDER_ATTEMPTED"){
          return
        }
        $(window).trigger("transactionValidation.vtex", [false]);
      });
  };

  render() {
    return <div></div>;
  }
}
