import express from "express";
import multer from "multer";
import { join } from "path";
import { createServer } from "http";
import { Server as socketIO } from "socket.io";
import { Client, GatewayIntentBits, AttachmentBuilder } from "discord.js";

const botToken = "";
const channelId = "";

const app = express();
const server = createServer(app);
const io = new socketIO(server);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let imageUrls = [];

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const refreshImageUrls = async () => {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) {
      console.error(`Channel not found: ${channelId}`);
      return;
    }

    console.log(`Refreshing image URLs from channel: ${channel.name}`);

    // Fetch messages in reverse chronological order
    const messages = await channel.messages.fetch({ limit: 100 });
    const sortedMessages = Array.from(messages.values()).sort(
      (a, b) => b.createdTimestamp - a.createdTimestamp
    );

    let tempImageUrls = [];

    sortedMessages.forEach((message) => {
      if (message.embeds?.length > 0) {
        message.embeds.forEach((embed) => {
          if (embed.image) tempImageUrls.push(embed.image.url);
          if (embed.thumbnail) tempImageUrls.push(embed.thumbnail.url);
        });
      }

      message.attachments.forEach((attachment) => {
        tempImageUrls.push(attachment.url);
      });
    });

    if (tempImageUrls.length > 0) {
      imageUrls = tempImageUrls;
      console.log(`Refreshed ${imageUrls.length} image URLs successfully`);
      io.emit("newImages", imageUrls);
    }
  } catch (error) {
    console.error("Error refreshing image URLs:", error);
  }
};

// Watch for new messages
client.on("messageCreate", async (message) => {
  if (message.channel.id === channelId) {
    let newImages = [];

    if (message.embeds?.length > 0) {
      message.embeds.forEach((embed) => {
        if (embed.image) newImages.push(embed.image.url);
        if (embed.thumbnail) newImages.push(embed.thumbnail.url);
      });
    }

    message.attachments.forEach((attachment) => {
      newImages.push(attachment.url);
    });

    if (newImages.length > 0) {
      // Add new images to the beginning of the array
      imageUrls = [...newImages, ...imageUrls];
      console.log(`Added ${newImages.length} new images`);
      io.emit("newImages", imageUrls);
    }
  }
});

// Watch for message deletions
client.on("messageDelete", async (message) => {
  if (message.channel.id === channelId) {
    let deletedUrls = [];

    if (message.embeds?.length > 0) {
      message.embeds.forEach((embed) => {
        if (embed.image) deletedUrls.push(embed.image.url);
        if (embed.thumbnail) deletedUrls.push(embed.thumbnail.url);
      });
    }

    message.attachments.forEach((attachment) => {
      deletedUrls.push(attachment.url);
    });

    if (deletedUrls.length > 0) {
      imageUrls = imageUrls.filter((url) => !deletedUrls.includes(url));
      console.log(`Removed ${deletedUrls.length} images`);
      io.emit("newImages", imageUrls);
    }
  }
});

// Watch for bulk message deletions
client.on("messageDeleteBulk", async (messages) => {
  let deletedUrls = [];

  messages.forEach((message) => {
    if (message.channel.id === channelId) {
      if (message.embeds?.length > 0) {
        message.embeds.forEach((embed) => {
          if (embed.image) deletedUrls.push(embed.image.url);
          if (embed.thumbnail) deletedUrls.push(embed.thumbnail.url);
        });
      }

      message.attachments.forEach((attachment) => {
        deletedUrls.push(attachment.url);
      });
    }
  });

  if (deletedUrls.length > 0) {
    imageUrls = imageUrls.filter((url) => !deletedUrls.includes(url));
    console.log(`Removed ${deletedUrls.length} images from bulk deletion`);
    io.emit("newImages", imageUrls);
  }
});

app.use(express.static(join(process.cwd())));

app.get("/", (req, res) => {
  res.sendFile(join(process.cwd(), "public/index.html"));
});

app.get("/images", (req, res) => {
  res.json(imageUrls);
});

server.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await refreshImageUrls();

  // Refresh URLs every 6 hours
  setInterval(refreshImageUrls, 6 * 60 * 60 * 1000);
});

app.post("/upload", upload.array("images", 100), async (req, res) => {
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

client.login(botToken);

// Middleware to handle file uploads
app.post("/upload", upload.array("images", 100), async (req, res) => {
  const files = req.files;
  if (!files || files.length === 0) {
    return res.status(400).send("No files uploaded.");
  }

  // Function to upload each file to Discord
  const uploadToDiscord = async (file) => {
    const attachment = new MessageAttachment(file.buffer, file.originalname); // Use file buffer from memory and original name

    try {
      const channel = await client.channels.fetch(channelId);

      // Send the image as a message with the file attachment
      const message = await channel.send({
        files: [attachment], // Attach the image file from memory
      });

      console.log(`Uploaded image to Discord: ${message.url}`);
      return message.url; // Return the image URL after upload
    } catch (error) {
      console.error("Error uploading image to Discord:", error);
      return null;
    }
  };

  const imageUrls = [];

  // Upload images one by one and keep track of the URLs
  for (let i = 0; i < files.length; i++) {
    const imageUrl = await uploadToDiscord(files[i]);
    if (imageUrl) {
      imageUrls.push(imageUrl);
    }
  }

  // Send the image URLs as a response
  res.json({ success: true, imageUrls });
});
