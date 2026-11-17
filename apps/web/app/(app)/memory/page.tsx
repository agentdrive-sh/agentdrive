import { resolveActiveWorkspace } from '../../../lib/workspace';
import { MemorySearch } from '../../../components/screens/memory-search';

export default async function MemoryPage({ searchParams }: { searchParams: Promise<{ workspace?: string }> }) {
  const { current } = await resolveActiveWorkspace((await searchParams).workspace);
  return <MemorySearch workspaceId={current?.id ?? null} />;
}
