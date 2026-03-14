import { ToolDispatchContext } from '../../router';
import { getConfigSnapshot } from '../../../config/resolver';
import { TOOLS_CATALOG } from '../../toolsCatalog';

export async function handleGetCapabilities(_ctx: ToolDispatchContext) {
  const configSnapshot = await getConfigSnapshot();
  return {
    schema_version: 'v1',
    tools: TOOLS_CATALOG,
    config_snapshot: configSnapshot
  };
}
