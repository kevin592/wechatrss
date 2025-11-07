import { Request, Response } from 'express';
import { PrismaClient } from '../../apps/server/node_modules/.prisma/client';

const prisma = new PrismaClient();

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  const cronAuth = process.env.CRON_SECRET;

  if (cronAuth && authHeader !== `Bearer ${cronAuth}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('Starting feed update...');

    const feeds = await prisma.feed.findMany({
      where: { status: 1 },
      select: { id: true },
    });

    console.log(`Found ${feeds.length} active feeds`);

    res.status(200).json({
      message: 'Feed update initiated',
      feedCount: feeds.length,
    });
  } catch (error) {
    console.error('Cron update error:', error);
    res.status(500).json({ error: 'Update failed' });
  }
}
