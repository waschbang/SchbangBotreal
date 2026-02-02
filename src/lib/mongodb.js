// const { MongoClient } = require("mongodb");
// require("dotenv").config();
// const uri = process.env.MONGODB_URI;

// if (!uri) {
//   console.error("MONGODB_URI is not defined. Please set it in your .env file.");
//   process.exit(1); // Exit the application
// }

// let client;
// let clientPromise;

// if (!global._mongoClientPromise) {
//   client = new MongoClient(uri, {
//     useNewUrlParser: true,
//     useUnifiedTopology: true,
//   });
//   global._mongoClientPromise = client.connect();
// }
// clientPromise = global._mongoClientPromise;

// module.exports = clientPromise; // Change to module.exports
