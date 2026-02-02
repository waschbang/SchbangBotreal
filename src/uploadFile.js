// const OpenAI = require("openai");
// const fs = require("fs");
// const dotenv = require("dotenv");

// dotenv.config();

// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY,
// });

// async function uploadFile() {
//   try {
//     const response = await openai.files.create({
//       file: fs.createReadStream("./src/training_data.jsonl"),
//       purpose: "fine-tune",
//     });

//     console.log("File uploaded:", response);
//   } catch (error) {
//     console.error("Error uploading file:", error);
//   }
// }

// uploadFile();