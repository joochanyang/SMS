const { Infobip, AuthType } = require('@infobip-api/sdk');
require('dotenv').config();

async function testInfobip() {
    console.log("---- Testing Infobip API ----");
    
    const apiKey = process.env.INFOBIP_API_KEY;
    const baseUrl = process.env.INFOBIP_URL;

    console.log("API KEY:", apiKey ? "Loaded (Hide value for security)" : "Missing");
    console.log("BASE URL:", baseUrl);
    
    if (!baseUrl || baseUrl.includes("your-infobip-base-url")) {
        console.log("❌ ERROR: INFOBIP_URL is missing or still set to the placeholder!");
        console.log("   Infobip requires YOUR unique Base URL (e.g., https://xxxxx.api.infobip.com)");
        return;
    }

    try {
        const balanceResponse = await fetch(`${baseUrl}/account/1/balance`, {
            method: 'GET',
            headers: {
                'Authorization': `App ${apiKey}`,
                'Accept': 'application/json'
            }
        });

        console.log("\n1. Testing Balance Endpoint (/account/1/balance):");
        if (balanceResponse.ok) {
            const data = await balanceResponse.json();
            console.log("   ✅ Balance OK:", data);
        } else {
            console.log(`   ❌ Balance Error: ${balanceResponse.status} ${balanceResponse.statusText}`);
            console.log("      " + await balanceResponse.text());
        }

        const reportsResponse = await fetch(`${baseUrl}/sms/1/reports`, {
            method: 'GET',
            headers: {
                'Authorization': `App ${apiKey}`,
                'Accept': 'application/json'
            }
        });

        console.log("\n2. Testing SMS Reports Endpoint (/sms/1/reports):");
        if (reportsResponse.ok) {
            console.log("   ✅ Reports OK (even if empty results)");
        } else {
            console.log(`   ❌ Reports Error: ${reportsResponse.status} ${reportsResponse.statusText}`);
            console.log("      " + await reportsResponse.text());
        }

    } catch (error) {
        console.log("\n❌ FAILED TO CONNECT:");
        console.error(error.message);
    }
}

testInfobip();
