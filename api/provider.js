export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(200).json({
    configured: Boolean(process.env.AGENTFORGE_PROVIDER_ADDRESS),
    address: process.env.AGENTFORGE_PROVIDER_ADDRESS || null,
    chainId: 97,
  });
}
