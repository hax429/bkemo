import axios from "axios";
import { authenticator } from 'otplib';
import crypto from 'crypto';
import { Feed } from "feed";
import jwt from 'jsonwebtoken';
import { prisma } from "@server/prisma";
import { User } from "@server/context";
import { Request as ExpressRequest } from 'express';
import { getGlobalConfig } from "@server/routerTrpc/config";

export const SendWebhook = async (data: any, webhookType: string, ctx: any) => {
  try {
    const globalConfig = await getGlobalConfig({ ctx })
    if (globalConfig.webhookEndpoint) {
      await axios.post(globalConfig.webhookEndpoint, { data, webhookType, activityType: `blinko.note.${webhookType}` })
    }
  } catch (error) {
    console.log('request webhook error:', error)
  }
}

export function generateTOTP(): string {
  return authenticator.generateSecret();
}

export function generateTOTPQRCode(username: string, secret: string): string {
  return authenticator.keyuri(username, 'bkemo', secret);
}

export function verifyTOTP(token: string, secret: string): boolean {
  try {
    return authenticator.verify({ token, secret });
  } catch (err) {
    return false;
  }
}


export async function generateFeed(userId: number, origin: string, rows: number = 20) {
  const hasAccountId: any = {}
  if (userId != 0) {
    hasAccountId.accountId = userId
  }
  const notes = await prisma.notes.findMany({
    where: {
      ...hasAccountId,
      isShare: true,
      sharePassword: "",
      OR: [
        {
          shareExpiryDate: {
            gt: new Date()
          }
        },
        {
          shareExpiryDate: null
        }
      ]
    },
    orderBy: { updatedAt: 'desc' },
    take: rows,
    select: {
      content: true,
      updatedAt: true,
      shareEncryptedUrl: true,
      tags: {
        include: { tag: true }
      },
      account: {
        select: {
          name: true
        }
      },
    }
  });

  const feed = new Feed({
    title: "Blinko Public Notes",
    description: "Latest public notes",
    id: origin,
    link: origin,
    copyright: "All rights reserved",
    updated: new Date(),
    image: `${origin}/logo-dark-title.png`,
    feedLinks: {
      atom: `${origin}/api/rss/${userId}/atom`,
      rss: `${origin}/api/rss/${userId}/rss`
    },
  });

  notes.forEach(note => {
    const title = note.content.split('\n')[0] || 'Untitled';
    feed.addItem({
      title,
      link: `${origin}/share/${note.shareEncryptedUrl}`,
      description: note.content.substring(0, 200) + '...',
      date: note.updatedAt,
      author: [{
        name: note.account!.name
      }],
      category: note.tags.map(i => {
        return {
          name: i.tag.name
        }
      })
    });
  });

  return feed;
}

const PLACEHOLDER_JWT_SECRET = 'my_ultra_secure_nextauth_secret';
let cachedJwtSecret: string | null = null;
let jwtSecretLoad: Promise<string> | null = null;

function explicitJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === PLACEHOLDER_JWT_SECRET) return null;
  return secret;
}

/**
 * Resolve the JWT signing secret once per process and cache it.
 *
 * Order: JWT_SECRET env → DB config → NEXTAUTH_SECRET env → generate.
 * Caching matters for Neon scale-to-zero: after the first resolve, JWT
 * verification no longer needs a live database connection.
 */
export const getNextAuthSecret = async () => {
  if (cachedJwtSecret) return cachedJwtSecret;

  const fromEnv = explicitJwtSecret();
  if (fromEnv) {
    cachedJwtSecret = fromEnv;
    return fromEnv;
  }

  if (!jwtSecretLoad) {
    jwtSecretLoad = (async () => {
      const configKey = 'JWT_SECRET';
      try {
        const savedSecret = await prisma.config.findFirst({ where: { key: configKey } });
        if (savedSecret) {
          // @ts-ignore
          const value = savedSecret.config.value as string;
          if (value) {
            cachedJwtSecret = value;
            return value;
          }
        }
      } catch (error) {
        const fallback = process.env.NEXTAUTH_SECRET;
        if (fallback && fallback !== PLACEHOLDER_JWT_SECRET) {
          console.warn('JWT secret DB lookup failed; using NEXTAUTH_SECRET fallback:', error);
          cachedJwtSecret = fallback;
          return fallback;
        }
        jwtSecretLoad = null;
        throw error;
      }

      const fallback = process.env.NEXTAUTH_SECRET;
      if (fallback && fallback !== PLACEHOLDER_JWT_SECRET) {
        cachedJwtSecret = fallback;
        return fallback;
      }

      const newSecret = crypto.randomBytes(32).toString('base64');
      await prisma.config.create({
        data: { key: configKey, config: { value: newSecret } },
      });
      cachedJwtSecret = newSecret;
      return newSecret;
    })();
  }

  return jwtSecretLoad;
}

/**
 * @deprecated Legacy unbounded account apiToken. Do not issue; use mintManagedAccessToken.
 * Kept only so old call sites fail closed after tokenType enforcement.
 */
export const generateApiToken = async (user: { id: number, name: string, role: string }, permissions?: string[]) => {
  const secret = await getNextAuthSecret();
  return jwt.sign(
    {
      role: user.role,
      name: user.name,
      sub: user.id.toString(),
      tokenType: 'legacy_api',
      exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 365 * 100),
      iat: Math.floor(Date.now() / 1000),
      permissions
    },
    secret
  );
};

/**
 * Mint a named, scope-limited access token (a JWT carrying expanded permission
 * paths). `jti` ties it to an `accessToken` row so it can be listed/revoked;
 * `expSeconds` is the absolute expiry (default: effectively never).
 * Omit `permissions` for full-app native tokens (session-equivalent ACL).
 */
export const generateAccessToken = async (
  user: { id: number; name: string; role: string },
  permissions: string[] | undefined,
  jti: string,
  expSeconds?: number,
  platform?: string,
) => {
  const secret = await getNextAuthSecret();
  const payload: Record<string, unknown> = {
    role: user.role,
    name: user.name,
    sub: user.id.toString(),
    tokenType: 'access',
    jti,
    exp: expSeconds ?? Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 365 * 100),
    iat: Math.floor(Date.now() / 1000),
  };
  if (permissions) payload.permissions = permissions;
  if (platform) payload.platform = platform;
  return jwt.sign(payload, secret);
};

export const generateToken = async (user: any, twoFactorVerified = false) => {
  const secret = await getNextAuthSecret();
  return jwt.sign(
    {
      sub: user.id,
      name: user.name,
      role: user.role || 'user',
      tokenType: 'session',
      twoFactorVerified,
      exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 30),
      iat: Math.floor(Date.now() / 1000)
    },
    secret,
    { algorithm: 'HS256' }
  );
};

export const verifyToken = async (token: string) => {
  const secret = await getNextAuthSecret();
  try {
    const decoded = jwt.verify(token, secret) as User;
    return decoded;
  } catch (error) {
    console.error('Token verification failed:', error);
    return null;
  }
};

/**
 * Accept only `session` and managed `access` tokens. Legacy apiToken JWTs
 * (no tokenType / legacy_api) are rejected. Access tokens require a live row;
 * platform mismatches soft-allow and record a misuse incident.
 */
const validateCredential = async (
  tokenData: any,
  declaredPlatform: string,
): Promise<boolean> => {
  const tokenType = tokenData?.tokenType;
  if (tokenType === 'session') return true;
  if (tokenType !== 'access' || !tokenData?.jti) return false;

  const row = await prisma.accessToken.findUnique({ where: { jti: tokenData.jti } });
  if (!row) return false;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return false;

  const now = Date.now();
  if (!row.lastUsedAt || now - new Date(row.lastUsedAt).getTime() > 60_000) {
    prisma.accessToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => { /* best-effort */ });
  }

  const expected = (row.platform || 'api').toLowerCase();
  if (declaredPlatform !== expected) {
    const { recordAccessTokenPlatformMismatch } = await import('./accessTokenService');
    recordAccessTokenPlatformMismatch({
      accountId: row.accountId,
      accessTokenId: row.id,
      tokenName: row.name,
      expectedPlatform: expected,
      observedPlatform: declaredPlatform,
    }).catch(() => { /* best-effort */ });
  }
  return true;
};

function declaredPlatformFromRequest(req: ExpressRequest): string {
  const raw = req.headers?.['x-bkemo-platform'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || !value.trim()) return 'unknown';
  const normalized = value.trim().toLowerCase();
  if (['web', 'macos', 'ios', 'obsidian', 'api'].includes(normalized)) return normalized;
  return 'unknown';
}

export const getTokenFromRequest = async (req: ExpressRequest) => {
  try {
    const declaredPlatform = declaredPlatformFromRequest(req);

    if (req.headers && typeof req.headers === 'object') {
      const authHeader = req.headers.authorization;
      if (authHeader) {
        const token = authHeader.replace("Bearer ", "");
        const tokenData = await verifyToken(token);
        if (tokenData && await validateCredential(tokenData, declaredPlatform)) {
          return { ...tokenData, id: tokenData.sub, token };
        }
      }
    }

    if (req.query && req.query.token) {
      const token = req.query.token as string;
      const tokenData = await verifyToken(token);
      if (tokenData && await validateCredential(tokenData, declaredPlatform)) {
        return { ...tokenData, id: tokenData.sub, token };
      }
    }

    return null;
  } catch (error) {
    console.error('Token retrieval error:', error);
    return null;
  }
}

export const getAllPathTags = async () => {
  const flattenTags = await prisma.tag.findMany();
  const hasHierarchy = flattenTags.some(tag => tag.parent != null);
  if (hasHierarchy) {
    const buildHashTagTreeFromDb = (tags: any[]) => {
      const tagMap = new Map();
      const rootNodes: any[] = [];
      tags.forEach(tag => {
        tagMap.set(tag.id, { ...tag, children: [] });
      });
      tags.forEach(tag => {
        if (tag.parent) {
          const parentNode = tagMap.get(tag.parent);
          if (parentNode) {
            parentNode.children.push(tagMap.get(tag.id));
          } else {
            rootNodes.push(tagMap.get(tag.id));
          }
        } else {
          rootNodes.push(tagMap.get(tag.id));
        }
      });

      return rootNodes;
    };

    const generateTagPaths = (node: any, parentPath = '') => {
      const currentPath = parentPath ? `${parentPath}/${node.name}` : `#${node.name}`;
      const paths = [currentPath];

      if (node.children && node.children.length > 0) {
        node.children.forEach((child: any) => {
          const childPaths = generateTagPaths(child, currentPath);
          paths.push(...childPaths);
        });
      }

      return paths;
    };

    const listTags = buildHashTagTreeFromDb(flattenTags);
    let pathTags: string[] = [];

    listTags.forEach(node => {
      pathTags = pathTags.concat(generateTagPaths(node));
    });

    return pathTags;
  } else {
    const tagPathMap = new Map();
    const tagSet = new Set<string>();
    flattenTags.forEach(tag => {
      const tagName = tag.name.startsWith('#') ? tag.name.substring(1) : tag.name;
      tagSet.add(tagName);
      tagPathMap.set(tagName, `#${tagName}`);
    });
    const pathTags: string[] = [];
    tagSet.forEach((tag: string) => {
      pathTags.push(`#${tag}`);
      if (tag.includes('/')) {
        const parts = tag.split('/');
        let currentPath = '#' + parts[0];
        pathTags.push(currentPath);

        for (let i = 1; i < parts.length; i++) {
          currentPath += '/' + parts[i];
          pathTags.push(currentPath);
        }
      }
    });
    return [...new Set(pathTags)];
  }
};


export const resetSequences = async () => {
  await prisma.$executeRaw`SELECT setval('notes_id_seq', (SELECT MAX(id) FROM "notes") + 1);`;
  await prisma.$executeRaw`SELECT setval('tag_id_seq', (SELECT MAX(id) FROM "tag") + 1);`;
  await prisma.$executeRaw`SELECT setval('"tagsToNote_id_seq"', (SELECT MAX(id) FROM "tagsToNote") + 1);`;
  await prisma.$executeRaw`SELECT setval('attachments_id_seq', (SELECT MAX(id) FROM "attachments") + 1);`;
}

export const getUserFromSession = (req: any) => {
  if (req && req.isAuthenticated && req.isAuthenticated() && req.user) {
    const user = req.user;
    return {
      id: user.id.toString(),
      sub: user.id.toString(),
      name: user.name,
      role: user.role || 'user',
      exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 * 1000,
      iat: Math.floor(Date.now() / 1000),
    };
  }
  return null;
};

export const getUserFromRequest = async (req: any) => {
  const sessionUser = getUserFromSession(req);
  if (sessionUser) {
    return sessionUser;
  }

  return await getTokenFromRequest(req);
};

// 生成带token的URL
export const generateUrlWithToken = async (url: string, user: any) => {
  const token = await generateToken(user);
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}token=${token}`;
}

