import { GoogleGenAI } from "@google/genai";
import { getLlmEnv } from "@engine/config/env";
import { lazy } from "@engine/utils/lazy";
import { SDK_MAX_RETRIES } from "./models";

/** Shared Google Gen AI client (grounded search), created on first use. */
export const getGenAI = lazy(
  () =>
    new GoogleGenAI({
      apiKey: getLlmEnv().GEMINI_API_KEY,
      // attempts includes the first request.
      httpOptions: { retryOptions: { attempts: 1 + SDK_MAX_RETRIES } },
    }),
);
