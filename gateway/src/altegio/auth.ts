export interface AltegioAuthConfig {
  partnerToken: string;
  userToken: string;
}

export function buildAltegioAuthHeaders(config: AltegioAuthConfig): Record<string, string> {
  // Format from Altegio docs:
  // Authorization: Bearer <partner_token>, User <user_token>
  return {
    Authorization: `Bearer ${config.partnerToken}, User ${config.userToken}`
  };
}

