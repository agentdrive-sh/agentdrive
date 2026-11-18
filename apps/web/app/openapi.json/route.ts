import spec from '../../../worker/openapi.json';

export const dynamic = 'force-static';

export function GET() {
  return Response.json(spec, { headers: { 'Access-Control-Allow-Origin': '*' } });
}
