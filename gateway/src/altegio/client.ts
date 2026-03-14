type HeadersInit = Record<string, string>;
import { withRateLimit } from './rateLimit';
import { buildAltegioAuthHeaders } from './auth';
import { DbPool } from '../audit/db';
import { writeHttpCall } from '../audit/writeHttpCall';
import { getConfig } from '../config/resolver';

export interface AltegioClientConfig {
  baseUrl: string;
  apiVersion: string;
  partnerToken: string;
  userToken: string;
}

export interface AltegioClientContext {
  db: DbPool;
  config: AltegioClientConfig;
}

function buildBaseUrl(config: AltegioClientConfig): string {
  // For B2B v1/v2 the actual server URL is typically:
  //   https://api.alteg.io/api/v1
  //   https://api.alteg.io/api/v2
  // even though the docs are labeled "b2b-v1"/"b2b-v2".
  const normalized = config.baseUrl.replace(/\/+$/, '');
  let versionSegment = config.apiVersion;
  if (versionSegment === 'b2b-v1') versionSegment = 'v1';
  if (versionSegment === 'b2b-v2') versionSegment = 'v2';
  return `${normalized}/api/${versionSegment}`;
}

async function doRequest(
  ctx: AltegioClientContext,
  mcpRequestId: string | undefined,
  method: string,
  path: string,
  options: {
    query?: Record<string, any>;
    body?: any;
    extraHeaders?: HeadersInit;
  } = {}
): Promise<any> {
  const startedAt = Date.now();
  const base = buildBaseUrl(ctx.config);

  const qs =
    options.query && Object.keys(options.query).length
      ? '?' +
        new URLSearchParams(
          Object.entries(options.query).reduce<Record<string, string>>(
            (acc, [k, v]) => {
              if (v === undefined || v === null) return acc;
              acc[k] = String(v);
              return acc;
            },
            {}
          )
        ).toString()
      : '';

  const url = `${base}${path}${qs}`;

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    // Altegio B2B docs require Accept header; v2 JSON is backward compatible for list endpoints.
    Accept: 'application/vnd.api.v2+json',
    ...buildAltegioAuthHeaders({
      partnerToken: ctx.config.partnerToken,
      userToken: ctx.config.userToken
    }),
    ...(options.extraHeaders ?? {})
  };

  const bodyJson = options.body ? JSON.stringify(options.body) : undefined;

  let resStatus: number | undefined;
  let resHeaders: Record<string, any> | undefined;
  let resBody: any;

  const httpTimeoutMs =
    (await getConfig<number>('timeouts.altegios_http_ms')) ?? 8000;
  const controller = new AbortController();
  const timeoutHandle =
    httpTimeoutMs > 0
      ? setTimeout(() => controller.abort(), httpTimeoutMs)
      : null;

  try {
    const res = await withRateLimit(() =>
      fetch(url, {
        method,
        headers,
        body: bodyJson,
        signal: controller.signal
      })
    );

    resStatus = res.status;

    const headersObj: Record<string, string> = {};
    // Node 20 fetch Headers supports forEach
    (res.headers as any).forEach((value: string, key: string) => {
      headersObj[key] = value;
    });
    resHeaders = headersObj;

    const text = await res.text();
    try {
      resBody = text ? JSON.parse(text) : null;
    } catch {
      resBody = text;
    }

    if (!res.ok) {
      const error = new Error(`Altegio HTTP ${res.status}`);
      (error as any).response = resBody;
      throw error;
    }

    return resBody;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    await writeHttpCall(ctx.db, {
      mcpRequestId,
      method,
      url,
      requestHeaders: headers as any,
      requestBody: options.body,
      responseStatus: resStatus,
      responseHeaders: resHeaders,
      responseBody: resBody,
      startedAt
    });
  }
}

export function createAltegioClient(db: DbPool, rawConfig: any) {
  const ctx: AltegioClientContext = {
    db,
    config: {
      baseUrl: rawConfig.ALTEGIO_BASE_URL,
      apiVersion: rawConfig.ALTEGIO_API_VERSION,
      partnerToken: rawConfig.ALTEGIO_PARTNER_TOKEN,
      userToken: rawConfig.ALTEGIO_USER_TOKEN
    }
  };

  return {
    searchClients(mcpRequestId: string, locationId: number, body: any) {
      // Uses v1 Clients search endpoint: POST /company/{location_id}/clients/search
      return doRequest(ctx, mcpRequestId, 'POST', `/company/${locationId}/clients/search`, {
        body
      });
    },

    searchAppointments(mcpRequestId: string, params: any) {
      return doRequest(ctx, mcpRequestId, 'GET', '/crm/appointments/search', {
        query: params
      });
    },

    rescheduleAppointment(mcpRequestId: string, payload: any) {
      return doRequest(ctx, mcpRequestId, 'POST', '/crm/appointments/reschedule', {
        body: payload
      });
    },

    cancelAppointment(mcpRequestId: string, payload: any) {
      return doRequest(ctx, mcpRequestId, 'POST', '/crm/appointments/cancel', {
        body: payload
      });
    },

    getStaffCalculations(mcpRequestId: string, params: any) {
      return doRequest(ctx, mcpRequestId, 'GET', '/payroll/staff/calculations', {
        query: params
      });
    },

    applySalaryResult(mcpRequestId: string, payload: any) {
      return doRequest(ctx, mcpRequestId, 'POST', '/payroll/staff/salary/apply', {
        body: payload
      });
    },

    listTeamMembers(mcpRequestId: string, locationId: number) {
      // Uses v1 Team Members endpoint: GET /staff/{location_id}
      return doRequest(ctx, mcpRequestId, 'GET', `/staff/${locationId}`);
    },

    listAppointments(mcpRequestId: string, locationId: number, filters: any) {
      // Uses v1 Appointments endpoint: GET /records/{location_id}
      return doRequest(ctx, mcpRequestId, 'GET', `/records/${locationId}`, {
        query: filters
      });
    },

    createAppointment(mcpRequestId: string, locationId: number, body: any) {
      return doRequest(ctx, mcpRequestId, 'POST', `/records/${locationId}`, {
        body
      });
    },

    listServices(mcpRequestId: string, locationId: number) {
      return doRequest(ctx, mcpRequestId, 'GET', `/services/${locationId}`);
    },

    /** GET /schedule/{location_id}/{team_member_id}/{start_date}/{end_date} — working slots per day. Dates YYYYMMDD. */
    getSchedule(
      mcpRequestId: string,
      locationId: number,
      teamMemberId: number,
      startDate: string,
      endDate: string
    ) {
      return doRequest(ctx, mcpRequestId, 'GET', `/schedule/${locationId}/${teamMemberId}/${startDate}/${endDate}`);
    },

    updateClient(mcpRequestId: string, locationId: number, clientId: number, body: { name?: string; surname?: string; phone: string }) {
      return doRequest(ctx, mcpRequestId, 'PUT', `/client/${locationId}/${clientId}`, {
        body
      });
    },

    updateRecord(mcpRequestId: string, locationId: number, recordId: number, body: any) {
      return doRequest(ctx, mcpRequestId, 'PUT', `/record/${locationId}/${recordId}`, {
        body
      });
    }
  };
}

