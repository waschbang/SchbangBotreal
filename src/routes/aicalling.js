const express = require("express");
const axios = require("axios");

let RTCPeerConnection = null;
let RTCSessionDescription = null;
try {
  const wrtc = require("wrtc");
  RTCPeerConnection = wrtc.RTCPeerConnection;
  RTCSessionDescription = wrtc.RTCSessionDescription;
} catch (_) {}

const pcStore = new Map();

const router = express.Router();

router.use(express.json());

async function generateSdpOffer() {
  if (!RTCPeerConnection) {
    const err = new Error("WebRTC module not available");
    err.code = "WRTC_MISSING";
    throw err;
  }
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  pc.addTransceiver("audio", { direction: "sendrecv" });
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  return { sdp: pc.localDescription.sdp, pc };
}

router.post("/initiate", async (req, res) => {
  try {
    const to = req.body?.to;
    const apiKey = req.body?.apiKey;
    const projectId = req.body?.projectId;
    const opaqueId = req.body?.opaqueId || `call-${Date.now()}`;
    if (!to || !apiKey || !projectId) {
      return res.status(400).json({ message: "to, apiKey, projectId required" });
    }

    let sdp;
    let pc;
    try {
      const r = await generateSdpOffer();
      sdp = r.sdp;
      pc = r.pc;
    } catch (e) {
      if (e.code === "WRTC_MISSING") {
        return res.status(501).json({ message: "Server WebRTC not available. Install 'wrtc' to enable." });
      }
      throw e;
    }

    pcStore.set(opaqueId, pc);

    const payload = {
      to,
      sdp,
      biz_opaque_callback_data: opaqueId,
    };

    const response = await axios.post(
      "https://apis.aisensy.com/project-apis/v1/call/initiate",
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "x-aisensy-project-api-pwd": apiKey,
          Project: projectId,
        },
        timeout: 15000,
      }
    );

    return res.status(200).json({ success: true, opaqueId, result: response.data });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/", (req, res) => {
  const body = req.body;

  console.log("=== AiSensy CALL WEBHOOK ===");
  console.log(JSON.stringify(body, null, 2));

  const topic = body?.topic;
  const callId = body?.data?.wa_call_id;
  const from = body?.data?.from;
  const opaqueId = body?.data?.biz_opaque_callback_data || body?.data?.opaque_id;

  try {
    const waCalls = body?.entry?.[0]?.changes?.[0]?.value?.calls;
    if (Array.isArray(waCalls) && waCalls.length > 0) {
      const first = waCalls[0];
      const event = first?.event;
      const direction = first?.direction;
      const sessionSdp = first?.session?.sdp;
      const sdpType = first?.session?.sdp_type;
      const inboundCallId = first?.id;

      if (event === "connect" && sdpType === "offer" && sessionSdp) {
        if (!RTCPeerConnection) {
          console.warn("WebRTC not available to generate SDP answer. Install 'wrtc'.");
        } else {
          const pc = new RTCPeerConnection({
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
          });
          pc.addTransceiver("audio", { direction: "sendrecv" });
          pcStore.set(inboundCallId, pc);
          pc
            .setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: sessionSdp }))
            .then(() => pc.createAnswer())
            .then((answer) => pc.setLocalDescription(answer).then(() => answer))
            .then((answer) => {
              const answerSdp = pc.localDescription?.sdp || answer?.sdp;
              console.log("Generated SDP Answer for inbound call:", inboundCallId);
              console.log(answerSdp);
              try {
                res.set("X-Generated-Answer", "true");
              } catch (_) {}
              return res.status(200).json({ ok: true, inboundCallId, direction, event, answerSdp });
            })
            .catch((e) => {
              console.error("Failed to generate SDP answer:", e.message);
              return res.status(200).send("ok");
            });
          return;
        }
      }
    }
  } catch (e) {
    console.error("Error handling inbound offer:", e.message);
  }

  if (topic === "call.connect") {
    console.log("\ud83d\udcde Incoming call detected!");
    console.log("Caller:", from);
    console.log("Call ID:", callId);
  }

  if (topic === "call.status") {
    console.log("\u260e\ufe0f Call Status:", body?.data?.status);
  }

  if (topic === "call.terminated") {
    console.log("\u274c Call Terminated");
    console.log("Recording:", body?.data?.recording_url);
    console.log("Transcript:", body?.data?.transcript_url);
  }

  try {
    const sdpAnswer = body?.data?.sdp || body?.data?.answer?.sdp || body?.sdp;
    if (sdpAnswer && opaqueId && RTCPeerConnection && RTCSessionDescription) {
      const pc = pcStore.get(opaqueId);
      if (pc) {
        pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: sdpAnswer }))
          .then(() => {
            console.log("Remote SDP answer set for", opaqueId);
          })
          .catch((e) => {
            console.error("Failed to set remote description:", e.message);
          });
      } else {
        console.warn("PeerConnection not found for opaqueId", opaqueId);
      }
    }
  } catch (e) {
    console.error("Error handling SDP answer:", e.message);
  }

  res.send("ok");
});

module.exports = router;
