import { createServerFn } from "@tanstack/react-start";
import {
  getCookie,
  getRequestHeader,
  getRequestUrl,
} from "@tanstack/react-start/server";
import { resolveLocale } from "./resolveLocale";
import type { Locale } from "./strings";

type GetServerLocaleInput = {
  userPreference?: string | null;
};

function validateInput(input: unknown): GetServerLocaleInput {
  if (!input || typeof input !== "object") {
    return {};
  }

  const record = input as Record<string, unknown>;
  return {
    userPreference:
      typeof record.userPreference === "string" ? record.userPreference : null,
  };
}

export const getServerLocale = createServerFn({ method: "GET" })
  .inputValidator(validateInput)
  .handler(({ data }): Locale => {
    const requestUrl = getRequestUrl({
      xForwardedHost: true,
      xForwardedProto: true,
    });

    return resolveLocale({
      searchParam: requestUrl.searchParams.get("lang"),
      cookieValue: getCookie("bv_locale") ?? null,
      userPreference: data.userPreference ?? null,
      countryCode:
        getRequestHeader("x-vercel-ip-country") ??
        getRequestHeader("cf-ipcountry") ??
        null,
      acceptLanguage: getRequestHeader("accept-language") ?? null,
    });
  });
