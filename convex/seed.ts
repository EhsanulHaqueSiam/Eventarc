import { internalMutation } from "./_generated/server";

export const seedSCBFamilyDay = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Check if already seeded
    const existing = await ctx.db.query("events").collect();
    if (existing.length > 0) {
      console.log("[SEED] Events already exist, skipping seed.");
      return;
    }

    const now = Date.now();
    // Event date: 3 months from now
    const eventDate = now + 90 * 24 * 60 * 60 * 1000;

    // 1. Create the event
    const eventId = await ctx.db.insert("events", {
      name: "SCB Family Day 2026",
      description:
        "Annual family day event for SCB employees with food stalls, entry gates, and entertainment",
      venue: "SCB Convention Hall, Dhaka",
      eventDate,
      status: "active",
      config: {
        qrStrategy: "separate",
        foodQrMode: "guestLinked",
        foodQrTiming: "preSent",
      },
      createdAt: now,
      updatedAt: now,
    });

    // 2. Guest categories
    const generalCatId = await ctx.db.insert("guestCategories", {
      eventId,
      name: "General",
      isDefault: true,
    });
    const vipCatId = await ctx.db.insert("guestCategories", {
      eventId,
      name: "VIP",
      isDefault: false,
    });
    const employeeCatId = await ctx.db.insert("guestCategories", {
      eventId,
      name: "Employee",
      isDefault: false,
    });
    const familyCatId = await ctx.db.insert("guestCategories", {
      eventId,
      name: "Family",
      isDefault: false,
    });

    // 3. Vendor types
    const entryTypeId = await ctx.db.insert("vendorTypes", {
      eventId,
      name: "entry",
    });
    const foodTypeId = await ctx.db.insert("vendorTypes", {
      eventId,
      name: "food",
    });

    // 4. Entry vendor categories + stalls
    const mainGateId = await ctx.db.insert("vendorCategories", {
      eventId,
      vendorTypeId: entryTypeId,
      name: "Main Gate",
    });
    await ctx.db.insert("stalls", {
      eventId,
      categoryId: mainGateId,
      name: "Gate A",
      isActive: true,
    });
    await ctx.db.insert("stalls", {
      eventId,
      categoryId: mainGateId,
      name: "Gate B",
      isActive: true,
    });

    const vipEntranceId = await ctx.db.insert("vendorCategories", {
      eventId,
      vendorTypeId: entryTypeId,
      name: "VIP Entrance",
    });
    await ctx.db.insert("stalls", {
      eventId,
      categoryId: vipEntranceId,
      name: "VIP Gate",
      isActive: true,
    });

    // 5. Food vendor categories + stalls
    const biryaniId = await ctx.db.insert("vendorCategories", {
      eventId,
      vendorTypeId: foodTypeId,
      name: "Biryani",
    });
    await ctx.db.insert("stalls", {
      eventId,
      categoryId: biryaniId,
      name: "Biryani Stall 1",
      isActive: true,
    });
    await ctx.db.insert("stalls", {
      eventId,
      categoryId: biryaniId,
      name: "Biryani Stall 2",
      isActive: true,
    });

    const drinksId = await ctx.db.insert("vendorCategories", {
      eventId,
      vendorTypeId: foodTypeId,
      name: "Drinks",
    });
    await ctx.db.insert("stalls", {
      eventId,
      categoryId: drinksId,
      name: "Cold Drinks",
      isActive: true,
    });
    await ctx.db.insert("stalls", {
      eventId,
      categoryId: drinksId,
      name: "Juice Bar",
      isActive: true,
    });

    const dessertId = await ctx.db.insert("vendorCategories", {
      eventId,
      vendorTypeId: foodTypeId,
      name: "Dessert",
    });
    await ctx.db.insert("stalls", {
      eventId,
      categoryId: dessertId,
      name: "Sweet Corner",
      isActive: true,
    });
    await ctx.db.insert("stalls", {
      eventId,
      categoryId: dessertId,
      name: "Ice Cream",
      isActive: true,
    });

    const fuchkaId = await ctx.db.insert("vendorCategories", {
      eventId,
      vendorTypeId: foodTypeId,
      name: "Fuchka",
    });
    await ctx.db.insert("stalls", {
      eventId,
      categoryId: fuchkaId,
      name: "Fuchka Stall 1",
      isActive: true,
    });
    await ctx.db.insert("stalls", {
      eventId,
      categoryId: fuchkaId,
      name: "Fuchka Stall 2",
      isActive: true,
    });

    // 6. Food rules
    const foodCategories = [biryaniId, drinksId, dessertId, fuchkaId];
    const guestCategories = [
      { id: vipCatId, limits: [2, -1, 2, 3] },
      { id: employeeCatId, limits: [1, 2, 1, 1] },
      { id: familyCatId, limits: [1, 2, 1, 1] },
      { id: generalCatId, limits: [1, 1, 1, 1] },
    ];

    for (const gc of guestCategories) {
      for (let i = 0; i < foodCategories.length; i++) {
        await ctx.db.insert("foodRules", {
          eventId,
          guestCategoryId: gc.id,
          foodCategoryId: foodCategories[i],
          limit: gc.limits[i],
        });
      }
    }

    // 7. Sample guests
    const sampleGuests = [
      { name: "Rahim Ahmed", phone: "01711000001", categoryId: vipCatId },
      { name: "Karim Hossain", phone: "01711000002", categoryId: vipCatId },
      { name: "Fatema Begum", phone: "01811000003", categoryId: employeeCatId },
      { name: "Nasir Uddin", phone: "01911000004", categoryId: employeeCatId },
      { name: "Ayesha Siddiqua", phone: "01511000005", categoryId: employeeCatId },
      { name: "Jamal Khan", phone: "01611000006", categoryId: familyCatId },
      { name: "Salma Khatun", phone: "01711000007", categoryId: familyCatId },
      { name: "Tariq Islam", phone: "01811000008", categoryId: generalCatId },
      { name: "Nusrat Jahan", phone: "01911000009", categoryId: generalCatId },
      { name: "Imran Hasan", phone: "01511000010", categoryId: generalCatId },
    ];

    for (const guest of sampleGuests) {
      await ctx.db.insert("guests", {
        eventId,
        name: guest.name,
        phone: guest.phone,
        categoryId: guest.categoryId,
        status: "invited",
        createdAt: now,
        updatedAt: now,
      });
    }

    console.log(
      `[SEED] Created SCB Family Day 2026 with 4 guest categories, 6 vendor categories, 10 stalls, food rules, and 10 sample guests.`,
    );
  },
});
