import { ReplitConnectors } from "@replit/connectors-sdk";
import type { GoogleSheetsCell } from "./agent-work/google-sheets-contract";

export type GoogleSheetsClient = {
  createSpreadsheet(input: {
    title: string;
    sheetTitle: string;
  }): Promise<{ spreadsheetId: string; spreadsheetUrl: string | null }>;
  updateValues(input: {
    spreadsheetId: string;
    sheetTitle: string;
    range: string;
    values: GoogleSheetsCell[][];
  }): Promise<void>;
  readValues(input: {
    spreadsheetId: string;
    sheetTitle: string;
    range: string;
  }): Promise<GoogleSheetsCell[][]>;
};

export type GoogleSheetsErrorOutcome = "rejected" | "unknown_result";

export class GoogleSheetsClientError extends Error {
  constructor(
    readonly code: string,
    readonly outcome: GoogleSheetsErrorOutcome,
    readonly httpStatus?: number,
  ) {
    super(code);
    this.name = "GoogleSheetsClientError";
  }
}

type GoogleSheetsResponse = {
  spreadsheetId?: unknown;
  spreadsheetUrl?: unknown;
  values?: unknown;
};

function isCell(value: unknown): value is GoogleSheetsCell {
  return value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
}

function safeSheetRange(sheetTitle: string, range: string): string {
  const quotedTitle = `'${sheetTitle.replaceAll("'", "''")}'`;
  return `${quotedTitle}!${range}`;
}

export class ReplitGoogleSheetsClient implements GoogleSheetsClient {
  constructor(private readonly connectors = new ReplitConnectors()) {}

  private async request(path: string, options: {
    method: "GET" | "POST" | "PUT";
    body?: Record<string, unknown>;
  }): Promise<GoogleSheetsResponse> {
    let response: Response;
    try {
      response = await this.connectors.proxy("google-sheet", path, {
        method: options.method,
        headers: options.body ? { "Content-Type": "application/json" } : undefined,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch {
      throw new GoogleSheetsClientError("GOOGLE_SHEETS_PROXY_UNAVAILABLE", "unknown_result");
    }

    const responseText = await response.text().catch(() => "");
    if (!response.ok) {
      const outcome = response.status >= 400 && response.status < 500
        ? "rejected"
        : "unknown_result";
      throw new GoogleSheetsClientError(
        `GOOGLE_SHEETS_HTTP_${response.status}`,
        outcome,
        response.status,
      );
    }

    try {
      const parsed = responseText ? JSON.parse(responseText) as GoogleSheetsResponse : {};
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("INVALID_RESPONSE");
      }
      return parsed;
    } catch {
      throw new GoogleSheetsClientError("GOOGLE_SHEETS_INVALID_RESPONSE", "unknown_result");
    }
  }

  async createSpreadsheet(input: {
    title: string;
    sheetTitle: string;
  }): Promise<{ spreadsheetId: string; spreadsheetUrl: string | null }> {
    const result = await this.request("/v4/spreadsheets", {
      method: "POST",
      body: {
        properties: { title: input.title },
        sheets: [{ properties: { title: input.sheetTitle } }],
      },
    });
    if (typeof result.spreadsheetId !== "string" || !result.spreadsheetId.trim()) {
      throw new GoogleSheetsClientError("GOOGLE_SHEETS_CREATE_RESULT_INCOMPLETE", "unknown_result");
    }
    return {
      spreadsheetId: result.spreadsheetId,
      spreadsheetUrl: typeof result.spreadsheetUrl === "string" ? result.spreadsheetUrl : null,
    };
  }

  async updateValues(input: {
    spreadsheetId: string;
    sheetTitle: string;
    range: string;
    values: GoogleSheetsCell[][];
  }): Promise<void> {
    const range = encodeURIComponent(safeSheetRange(input.sheetTitle, input.range));
    await this.request(
      `/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}/values/${range}?valueInputOption=RAW`,
      {
        method: "PUT",
        body: { values: input.values },
      },
    );
  }

  async readValues(input: {
    spreadsheetId: string;
    sheetTitle: string;
    range: string;
  }): Promise<GoogleSheetsCell[][]> {
    const range = encodeURIComponent(safeSheetRange(input.sheetTitle, input.range));
    const result = await this.request(
      `/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}/values/${range}?valueRenderOption=UNFORMATTED_VALUE`,
      { method: "GET" },
    );
    if (result.values === undefined) return [];
    if (!Array.isArray(result.values) || result.values.some((row) =>
      !Array.isArray(row) || row.some((value) => !isCell(value)))) {
      throw new GoogleSheetsClientError("GOOGLE_SHEETS_INVALID_VALUES_RESPONSE", "unknown_result");
    }
    return result.values as GoogleSheetsCell[][];
  }
}