/**
 * Type definitions for the LLM chat application.
 */

export interface Env {
  /**
   * Binding for the Workers AI API.
   */
  AI: any;

  /**
   * START: Add this line
   * Binding for the Google API Key secret.
   */
  GOOGLE_API_KEY: "AIzaSyAHNAY-pb8EqB5mR9aV9MV4k0dcIlHSAnw";

  /**
   * Binding for static assets.
   */
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

/**
 * Represents a chat message.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
