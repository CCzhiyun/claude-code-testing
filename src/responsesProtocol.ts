/** Responses wire contract. Existing transcript blocks are a compatibility view, not a wire schema. */
export type ResponsesItem = Record<string, unknown>;
export interface ResponsesRequest {
  model: string;
  instructions?: string;
  input: string | ResponsesItem[];
  max_output_tokens?: number;
  store?: boolean;
  stream?: boolean;
  tool_choice?: 'auto' | 'none' | 'required';
  previous_response_id?: string;
  include?: string[];
  reasoning?: { effort: string };
  service_tier?: string;
  text?: { format: Record<string, unknown> };
  tools?: Array<{ type: 'function'; name: string; description?: string; parameters: Record<string, unknown>; strict?: boolean }>;
}
export interface ResponsesResponse extends Record<string, unknown> {
  id?: string;
  object?: 'response';
  status: 'completed';
  output: ResponsesItem[];
  usage?: Record<string, unknown>;
}
