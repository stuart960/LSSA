// ======================================
// LOAD ENV VARIABLES
// ======================================
require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ======================================
// ENV VARIABLES
// ======================================
const PESAPAL_KEY = process.env.PESAPAL_KEY;
const PESAPAL_SECRET = process.env.PESAPAL_SECRET;
const BASE_URL = process.env.BASE_URL || "https://lssa.onrender.com";
const PESAPAL_IPN_ID = process.env.PESAPAL_IPN_ID;
const PORT = process.env.PORT || 3000;

// ======================================
// TOKEN CACHE
// ======================================
let cachedToken = null;
let tokenExpiry = null;

// ======================================
// GET PESAPAL TOKEN
// ======================================
async function getToken() {
    const now = Date.now();

    if (cachedToken && tokenExpiry && now < tokenExpiry) {
        return cachedToken;
    }

    const res = await axios.post(
        "https://pay.pesapal.com/v3/api/Auth/RequestToken",
        {
            consumer_key: PESAPAL_KEY,
            consumer_secret: PESAPAL_SECRET
        }
    );

    cachedToken = res.data.token;
    tokenExpiry = now + 50 * 60 * 1000; // 50 minutes

    return cachedToken;
}

// ======================================
// HOME ROUTE
// ======================================
app.get("/", (req, res) => {
    res.send("LSSA Pesapal Backend Running");
});

// ======================================
// CREATE PAYMENT
// ======================================
app.post("/pay", async (req, res) => {
    try {
        const { account, amount, phone } = req.body;

        if (!account || !amount || !phone) {
            return res.status(400).json({ error: "Missing account, amount, or phone" });
        }

        const token = await getToken();
        const orderId = "LSSA_" + Date.now();

        const response = await axios.post(
            "https://pay.pesapal.com/v3/api/Transactions/SubmitOrderRequest",
            {
                id: orderId,
                currency: "UGX",
                amount: Number(amount),
                description: `LSSA Payment - ${account}`,
                callback_url: `${BASE_URL}/payment-success`,
                notification_id: PESAPAL_IPN_ID,
                billing_address: {
                    phone_number: phone,
                    country_code: "UG"
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            }
        );

        res.json({
            success: true,
            orderId,
            redirect_url: response.data.redirect_url
        });
    } catch (err) {
        console.error(err.response?.data || err.message);
        res.status(500).json({ error: "Payment creation failed" });
    }
});

// ======================================
// PAYMENT SUCCESS CALLBACK
// ======================================
app.get("/payment-success", (req, res) => {
    const orderTrackingId = req.query.OrderTrackingId;
    const merchantRef = req.query.OrderMerchantReference;

    console.log("SUCCESS CALLBACK:", { orderTrackingId, merchantRef });

    res.send(`
        <h2>Payment Received</h2>
        <p>We are verifying your payment...</p>
    `);
});

// ======================================
// PESAPAL WEBHOOK (IPN)
// ======================================
app.post("/pesapal-webhook", async (req, res) => {
    try {
        console.log("WEBHOOK RECEIVED:", req.body);

        const OrderTrackingId = req.body.OrderTrackingId || req.query.OrderTrackingId;
        const OrderMerchantReference = req.body.OrderMerchantReference || req.query.OrderMerchantReference;

        if (!OrderTrackingId) {
            return res.status(400).json({ error: "Missing OrderTrackingId" });
        }

        const token = await getToken();
        const statusRes = await axios.get(
            `https://pay.pesapal.com/v3/api/Transactions/GetTransactionStatus?orderTrackingId=${OrderTrackingId}`,
            { headers: { Authorization: `Bearer ${token}` } }
        );

        const paymentStatus = statusRes.data.payment_status_description;
        console.log("PAYMENT STATUS:", paymentStatus);

        if (paymentStatus?.toLowerCase() === "completed") {
            console.log("PAYMENT SUCCESSFUL");
            // TODO: Update your Supabase database here
        }

        res.json({ message: "IPN processed" });
    } catch (err) {
        console.error(err.response?.data || err.message);
        res.status(500).json({ error: "Webhook error" });
    }
});

// ======================================
// START SERVER
// ======================================
app.listen(PORT, () => {
    console.log(`LSSA server running on port ${PORT}`);
});