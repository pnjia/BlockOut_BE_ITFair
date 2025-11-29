import prisma from '../../../lib/prisma';
import { OAuth2Client } from 'google-auth-library';
import runCors from '../../../lib/cors';
import { generateTokens } from '../../../lib/jwt';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const client = new OAuth2Client(CLIENT_ID);

async function verifyGoogleToken(idToken) {
  const ticket = await client.verifyIdToken({
    idToken: idToken,
    audience: CLIENT_ID, 
  });
  return ticket.getPayload();
}

async function findOrCreateUser(payload) {
  const { email, given_name, family_name } = payload;
  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        firstName: given_name || "User",
        lastName: family_name || "",
        avatarGender: "MALE", 
        equippedTop: "starter_hair",
        equippedShirt: "starter_shirt",
        equippedPants: "starter_pants",
        equippedShoes: "starter_shoes"
      }
    });
  }
  return user;
}

export default async function handler(req, res) {
  if (runCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: 'Missing idToken' });

  try {
    const googlePayload = await verifyGoogleToken(idToken);
    const user = await findOrCreateUser(googlePayload);
    
    const { accessToken, refreshToken } = generateTokens(user.id);

    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken }
    });

    return res.status(200).json({
      message: 'Google Login success',
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        firstName: user.firstName,
        email: user.email,
        isNewUser: !user.createdAt 
      }
    });

  } catch (error) {
    console.error("API Error:", error.message);
    return res.status(401).json({ error: 'Invalid Google Token' });
  }
}