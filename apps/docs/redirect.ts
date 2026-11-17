// docs.agentdrive.sh is a permanent redirect to the canonical, branded docs at
// agentdrive.sh/docs (served by the Next.js marketing app via fumadocs). The
// subdomain is kept only so older links (installer, shipped docs) still land
// users on the real docs instead of breaking.
export default {
  fetch(request: Request): Response {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+/, '');
    const dest = `https://agentdrive.sh/docs${path ? `/${path}` : ''}${url.search}`;
    return Response.redirect(dest, 301);
  },
};
