"use client";
import {
  ChatOptions,
  getHeaders,
  LLMApi,
  LLMModel,
  MultimodalContent,
} from "../api";
import { fetch } from "@/app/utils/stream";
import { getTimeoutMSByModel } from "@/app/utils";
import { useAccessStore, useChatStore } from "@/app/store";
import { ApiPath, SOOCHOW_LIFE_BASE_URL, SoochowLife } from "@/app/constant";
import { streamWithThink } from "@/app/utils/chat";
import { getClientConfig } from "@/app/config/client";

interface RequestPayload {
  message: string | MultimodalContent[];
  userId: string;
}

interface ResponsePayload {
  message: string | MultimodalContent[];
}

export class SoochowLifeClient implements LLMApi {
  path(path: string): string {
    const accessStore = useAccessStore.getState();
    let baseUrl = "";

    if (accessStore.useCustomConfig) {
      baseUrl = accessStore.soochowLifeUrl;
    }

    if (baseUrl.length === 0) {
      const isApp = !!getClientConfig()?.isApp;
      baseUrl = isApp ? SOOCHOW_LIFE_BASE_URL : ApiPath.SoochowLife;
    }

    if (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, baseUrl.length - 1);
    }
    if (
      !baseUrl.startsWith("http") &&
      !baseUrl.startsWith(ApiPath.SoochowLife)
    ) {
      baseUrl = "https://" + baseUrl;
    }

    console.log("[Proxy Endpoint] ", baseUrl, path);

    return [baseUrl, path].join("");
  }

  async chat(options: ChatOptions) {
    const messages: ChatOptions["messages"] = [];

    const session = useChatStore.getState().currentSession();
    const shouldStream = !!options.config.stream;

    const requestPayload: RequestPayload = {
      userId: session.id,
      message: options.messages[options.messages.length - 1].content,
    };
    console.log("[Request] Tencent payload: ", requestPayload);

    const controller = new AbortController();
    options.onController?.(controller);

    try {
      const headers = {
        ...getHeaders(),
      };

      const chatPath = this.path(SoochowLife.ChatPath);

      const chatPayload = {
        method: "POST",
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
        headers: headers,
      };

      // make a fetch request
      const requestTimeoutId = setTimeout(
        () => controller.abort(),
        getTimeoutMSByModel(options.config.model),
      );

      if (shouldStream) {
        return streamWithThink(
          chatPath,
          requestPayload,
          getHeaders(),
          [],
          {},
          controller,
          // parseSSE
          (text: string) => {
            return {
              isThinking: false,
              content: text,
            };
          },
          // processToolMessage, include tool_calls message and tool call results
          (
            requestPayload: RequestPayload,
            toolCallMessage: any,
            toolCallResult: any[],
          ) => {
            requestPayload;
          },
          options,
        );
      } else {
        const res = await fetch(chatPath, chatPayload);
        clearTimeout(requestTimeoutId);
        const resJson = await res.text();
        options.onFinish(resJson, res);
      }
    } catch (e) {
      console.log("[Request] failed to make a chat request", e);
      options.onError?.(e as Error);
    }
  }

  public async models(): Promise<LLMModel[]> {
    return [
      {
        name: "soochowLife",
        available: true,
        sorted: 15,
        provider: {
          id: "soochowLife",
          providerName: "SoochowLife",
          providerType: "soochowLife",
          sorted: 15,
        },
      },
    ];
  }

  public async usage(): Promise<any> {
    return {
      used: 0,
      total: 0,
    };
  }

  public async speech(options: any): Promise<any> {
    throw new Error("Speech not supported by Tencent Bot");
  }
}
