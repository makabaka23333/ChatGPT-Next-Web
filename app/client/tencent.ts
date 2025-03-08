"use client";
import { ChatOptions, getHeaders, LLMApi, LLMModel, MessageRole } from "./api";
import { v4 as uuidv4 } from "uuid";
import { fetch } from "@/app/utils/stream";
import {
  getMessageTextContent,
  getMessageTextContentWithoutThinking,
  getTimeoutMSByModel,
} from "@/app/utils";
import { useAccessStore, useChatStore, usePluginStore } from "@/app/store";
import { Tencent } from "@/app/constant";
import { streamWithThink } from "@/app/utils/chat";

interface RequestPayload {
  request_id: string;
  content: any;
  session_id: string;
  bot_app_key: string;
  visitor_biz_id: string;
  system_role: string;
}

export class TencentClient implements LLMApi {
  extractMessage(res: any) {
    return res?.output?.choices?.at(0)?.message?.content ?? "";
  }

  joinMessage(res: ChatOptions["messages"], role: MessageRole) {
    return res
      .filter((m) => m.role === role)
      .map((m) => m.content)
      .join("\n");
  }

  async chat(options: ChatOptions) {
    const tencentBotAppKey = useAccessStore.getState().tencentBotAppKey;
    const messages: ChatOptions["messages"] = [];
    for (const v of options.messages) {
      const content = (
        v.role === "assistant"
          ? getMessageTextContentWithoutThinking(v)
          : getMessageTextContent(v)
      ) as any;
      messages.push({ role: v.role, content });
    }

    const sessionId = useChatStore.getState().currentSession().id;
    const shouldStream = !!options.config.stream;

    const requestPayload: RequestPayload = {
      request_id: uuidv4(),
      content: this.joinMessage(messages, "user"),
      session_id: sessionId,
      bot_app_key: tencentBotAppKey,
      visitor_biz_id: sessionId,
      system_role: this.joinMessage(messages, "system"),
    };
    console.log("[Request] Tencent payload: ", requestPayload);

    const controller = new AbortController();
    options.onController?.(controller);

    try {
      const headers = {
        ...getHeaders(),
      };

      const chatPath = Tencent.ExampleEndpoint + Tencent.ChatPath;
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
        const [tools, funcs] = usePluginStore
          .getState()
          .getAsTools(
            useChatStore.getState().currentSession().mask?.plugin || [],
          );
        return streamWithThink(
          chatPath,
          requestPayload,
          getHeaders(),
          tools as any,
          funcs,
          controller,
          // parseSSE
          (text: string) => {
            const json = JSON.parse(text);
            const choices = json.payload as {
              can_feedback: boolean;
              can_rating: boolean;
              content: string;
              docs: null;
              file_infos: null;
              from_avatar: string;
              from_name: string;
              intent_category: string;
              is_evil: boolean;
              is_final: boolean;
              is_from_self: boolean;
              is_llm_generated: boolean;
              knowledge: null;
              option_cards: null;
              quote_infos: null;
              record_id: string;
              related_record_id: string;
              reply_method: number;
              request_id: string;
              session_id: string;
              timestamp: number;
              trace_id: string;
            };
            try {
              if (
                json.type === "reply" &&
                !choices.is_from_self &&
                !choices.is_final
              ) {
                return {
                  isThinking: false,
                  content: json.payload.content,
                };
              } else if (json.type === "error") {
                console.log(json.error.message);
                options.onError?.(new Error(json.error.message));
              }
            } catch (e) {
              console.log("[Request] failed to make a chat request", e);
              options.onError?.(e as Error);
            }
            return {
              isThinking: false,
              content: "",
            };
          },
          // processToolMessage, include tool_calls message and tool call results
          (
            requestPayload: RequestPayload,
            toolCallMessage: any,
            toolCallResult: any[],
          ) => {
            requestPayload?.content?.splice(
              requestPayload?.content?.length,
              0,
              toolCallMessage,
              ...toolCallResult,
            );
          },
          options,
        );
      } else {
        const res = await fetch(chatPath, chatPayload);
        clearTimeout(requestTimeoutId);

        const resJson = await res.json();
        const message = this.extractMessage(resJson);
        options.onFinish(message, res);
      }
    } catch (e) {
      console.log("[Request] failed to make a chat request", e);
      options.onError?.(e as Error);
    }
  }

  public async models(): Promise<LLMModel[]> {
    return [
      {
        name: "tencent-bot",
        available: true,
        provider: {
          id: "tencent",
          providerName: "Tencent",
          providerType: "tencent",
          sorted: 0,
        },
        sorted: 1000,
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
