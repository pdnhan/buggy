const API_URL = process.env.TEST_MGMT_API_URL || "http://localhost:3000";
const API_KEY = process.env.TEST_MGMT_API_KEY;

if (!API_KEY) {
  throw new Error("TEST_MGMT_API_KEY environment variable is not set");
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  issues?: unknown[];
}

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

// NOTE: (path, method, body) — every tools/*.ts call site passes arguments in
// this order. Both used to be plain `string`, so a swapped call compiled
// cleanly and the server crashed silently at request time; HttpMethod makes
// that class of mistake a compile error instead.
export async function apiCall<T>(
  path: string,
  method: HttpMethod,
  body?: unknown
): Promise<T> {
  const url = new URL(path, API_URL);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
  };

  const options: RequestInit = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    const errorMsg = typeof data === "object" && data !== null && "error" in data
      ? String(data.error)
      : `HTTP ${response.status}`;
    throw new ApiError(errorMsg, response.status, data);
  }

  return data as T;
}
