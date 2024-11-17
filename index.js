import express from "express";
import multer from "multer";
import { join } from "path";
import { createServer } from "http";
import { Server as socketIO } from "socket.io";
import { Client, GatewayIntentBits, AttachmentBuilder } from "discord.js";
import "dotenv/config";

const botToken = process.env.token;
const channelId = process.env.cid;
const manageUser = process.env.manageuser;
const managePass = process.env.managepass;

const app = express();
const server = createServer(app);
const io = new socketIO(server);

app.use(express.json());

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let imageUrls = new Set();

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const fetchAllMessages = async (channel) => {
  let allMessages = [];
  let lastMessageId = null;
  let hasMoreMessages = true;

  while (hasMoreMessages) {
    const options = lastMessageId
      ? { limit: 100, before: lastMessageId }
      : { limit: 100 };
    const messages = await channel.messages.fetch(options);

    if (messages.size === 0) {
      hasMoreMessages = false;
    } else {
      allMessages.push(...messages.values());
      lastMessageId = messages.last().id;
    }
  }

  return allMessages;
};

const refreshImageUrls = async () => {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) {
      console.error(`Channel not found: ${channelId}`);
      return;
    }

    console.log(`Refreshing image URLs from channel: ${channel.name}`);
    const messages = await fetchAllMessages(channel);
    const tempImageUrls = [];

    messages.forEach((message) => {
      if (message.embeds?.length > 0) {
        message.embeds.forEach((embed) => {
          if (embed.image) tempImageUrls.unshift(embed.image.url);
          if (embed.thumbnail) tempImageUrls.unshift(embed.thumbnail.url);
        });
      }

      message.attachments.forEach((attachment) => {
        tempImageUrls.unshift(attachment.url);
      });
    });

    imageUrls = new Set(tempImageUrls);
    io.emit("newImages", Array.from(imageUrls));
    console.log(`Refreshed ${imageUrls.size} image URLs successfully`);
  } catch (error) {
    console.error("Error refreshing image URLs:", error);
  }
};

client.on("messageCreate", async (message) => {
  if (message.channel.id === channelId) {
    const newImages = [];

    if (message.embeds?.length > 0) {
      message.embeds.forEach((embed) => {
        if (embed.image) newImages.unshift(embed.image.url);
        if (embed.thumbnail) newImages.unshift(embed.thumbnail.url);
      });
    }

    message.attachments.forEach((attachment) => {
      newImages.unshift(attachment.url);
    });

    if (newImages.length > 0) {
      newImages.forEach((url) => imageUrls.add(url));
      console.log(`Added ${newImages.length} new images`);
      io.emit("newImages", Array.from(imageUrls));
    }
  }
});

client.on("messageDelete", async (message) => {
  if (message.channel.id === channelId) {
    const deletedUrls = new Set();

    if (message.embeds?.length > 0) {
      message.embeds.forEach((embed) => {
        if (embed.image) deletedUrls.add(embed.image.url);
        if (embed.thumbnail) deletedUrls.add(embed.thumbnail.url);
      });
    }

    message.attachments.forEach((attachment) => {
      deletedUrls.add(attachment.url);
    });

    if (deletedUrls.size > 0) {
      deletedUrls.forEach((url) => imageUrls.delete(url));
      console.log(`Removed ${deletedUrls.size} images`);
      io.emit("newImages", Array.from(imageUrls));
    }
  }
});

client.on("messageDeleteBulk", async (messages) => {
  const deletedUrls = new Set();

  messages.forEach((message) => {
    if (message.channel.id === channelId) {
      if (message.embeds?.length > 0) {
        message.embeds.forEach((embed) => {
          if (embed.image) deletedUrls.add(embed.image.url);
          if (embed.thumbnail) deletedUrls.add(embed.thumbnail.url);
        });
      }

      message.attachments.forEach((attachment) => {
        deletedUrls.add(attachment.url);
      });
    }
  });

  if (deletedUrls.size > 0) {
    deletedUrls.forEach((url) => imageUrls.delete(url));
    console.log(`Removed ${deletedUrls.size} images from bulk deletion`);
    io.emit("newImages", Array.from(imageUrls));
  }
});

app.use(express.static(join(process.cwd())));

app.get("/", (req, res) => {
  res.sendFile(join(process.cwd(), "public/static.html"));
});

app.get("/upload", (req, res) => {
  res.sendFile(join(process.cwd(), "public/upload.html"));
});

app.get("/manage", (req, res) => {
  res.sendFile(join(process.cwd(), "public/manage.html"));
});

app.get("/images", (req, res) => {
  res.json(Array.from(imageUrls));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (username === manageUser && password === managePass) {
    res.status(200).send("Login successful");
  } else {
    res.status(401).send("Invalid username or password");
  }
});

app.delete("/delete", async (req, res) => {
  const { imageUrl } = req.query;
  if (!imageUrl) {
    return res.status(400).send("Image URL is required");
  }

  try {
    const channel = await client.channels.fetch(channelId);
    const messages = await channel.messages.fetch({ limit: 100 });

    let messageToDelete = null;
    for (const msg of messages.values()) {
      if (msg.embeds?.length > 0) {
        const hasImage = msg.embeds.some(
          (embed) =>
            (embed.image && embed.image.url === imageUrl) ||
            (embed.thumbnail && embed.thumbnail.url === imageUrl)
        );
        if (hasImage) {
          messageToDelete = msg;
          break;
        }
      }

      if (msg.attachments.some((attachment) => attachment.url === imageUrl)) {
        messageToDelete = msg;
        break;
      }
    }

    if (messageToDelete) {
      await messageToDelete.delete();
      imageUrls.delete(imageUrl);
      io.emit("newImages", Array.from(imageUrls));
      res.status(200).send("Image deleted successfully");
    } else {
      imageUrls.delete(imageUrl);
      io.emit("newImages", Array.from(imageUrls));
      res.status(200).send("Image URL removed from list");
    }
  } catch (error) {
    console.error("Error deleting image:", error);
    res.status(500).send("Error deleting image: " + error.message);
  }
});

app.post("/upload", upload.array("images", 1600), async (req, res) => {
  const files = req.files;
  if (!files || files.length === 0) {
    return res.status(400).send("No files uploaded.");
  }

  const uploadToDiscord = async (file) => {
    const attachment = new AttachmentBuilder(file.buffer, {
      name: file.originalname,
    });
    try {
      const channel = await client.channels.fetch(channelId);
      const message = await channel.send({ files: [attachment] });
      return message.attachments.first().url;
    } catch (error) {
      console.error("Error uploading image to Discord:", error);
      return null;
    }
  };

  const uploadedImageUrls = [];
  for (const file of files) {
    const imageUrl = await uploadToDiscord(file);
    if (imageUrl) {
      uploadedImageUrls.push(imageUrl);
    }
  }

  res.json({ success: true, imageUrls: uploadedImageUrls });
});

server.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await refreshImageUrls();
  setInterval(refreshImageUrls, 6 * 60 * 60 * 1000);
});

client.login(botToken);
