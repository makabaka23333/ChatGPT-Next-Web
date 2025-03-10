"use client";
import { ChatOptions, getHeaders, LLMApi, LLMModel, MessageRole } from "./api";
import { v4 as uuidv4 } from "uuid";
import { fetch } from "@/app/utils/stream";
import {
  getMessageTextContent,
  getMessageTextContentWithoutThinking,
  getTimeoutMSByModel,
  trimTopic,
} from "@/app/utils";
import {
  DEFAULT_TOPIC,
  useAccessStore,
  useChatStore,
  usePluginStore,
} from "@/app/store";
import { Tencent } from "@/app/constant";
import { streamWithThink } from "@/app/utils/chat";

interface RequestPayload {
  request_id: string;
  content: any;
  session_id: string;
  bot_app_key: string;
  visitor_biz_id: string;
  system_role: string;
  streaming_throttle: number;
}

type messageType = "reply" | "thought";

interface ResponsePayload {
  type: messageType;
  payload: {
    can_feedback: boolean;
    can_rating: boolean;
    content: string;
    docs: string;
    file_infos: string;
    from_avatar: string;
    from_name: string;
    intent_category: string;
    is_evil: boolean;
    is_final: boolean;
    is_from_self: boolean;
    is_llm_generated: boolean;
    knowledge: string;
    option_cards: string;
    quote_infos: string;
    record_id: string;
    related_record_id: string;
    reply_method: number;
    request_id: string;
    session_id: string;
    timestamp: number;
    trace_id: string;
    procedures: [
      {
        debugging: {
          content: string;
        };
      },
    ];
  };
}

export class TencentClient implements LLMApi {
  private currentResponseText: any = ""; // 添加跟踪变量
  private thoughtResponseText: any = ""; // 添加跟踪变量

  extractMessage(res: any) {
    return res?.output?.choices?.at(0)?.message?.content ?? "";
  }

  joinQMessage(res: ChatOptions["messages"], role: MessageRole) {
    return res
      .reverse()
      .filter((m) => m.role === role)
      .map((m) => m.content)
      .join("\n");
  }

  joinAMessage(message: ResponsePayload) {
    if (message.type === "reply") {
      let msg = message.payload.content.slice(this.currentResponseText.length);
      this.currentResponseText = message.payload.content;
      return msg;
    } else if (message.type === "thought") {
      let msg = message.payload.procedures[0].debugging.content.slice(
        this.thoughtResponseText.length,
      );
      this.thoughtResponseText =
        message.payload.procedures[0].debugging.content;
      return msg;
    }
  }

  async chat(options: ChatOptions) {
    this.currentResponseText = ""; // 重置响应文本
    this.thoughtResponseText = ""; // 重置响应文本
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

    const session = useChatStore.getState().currentSession();
    const shouldStream = !!options.config.stream;

    const requestPayload: RequestPayload = {
      request_id: uuidv4(),
      content: JSON.stringify(messages),
      session_id: session.id,
      bot_app_key: tencentBotAppKey,
      visitor_biz_id: session.id,
      system_role: this.joinQMessage(messages, "system"),
      streaming_throttle: 1,
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
            const choices = {
              ...json,
            } as ResponsePayload;
            try {
              if (
                !choices.payload.is_from_self &&
                (json.type === "reply" || json.type === "thought")
              ) {
                if (choices.payload.from_name) {
                  useChatStore
                    .getState()
                    .updateTargetSession(
                      session,
                      (session) =>
                        (session.topic =
                          choices.payload.from_name.length > 0
                            ? trimTopic(choices.payload.from_name)
                            : DEFAULT_TOPIC),
                    );
                }
                // 只返回增量内容
                const incrementalContent = this.joinAMessage(choices);
                return {
                  isThinking: choices.type === "thought",
                  content: incrementalContent,
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
