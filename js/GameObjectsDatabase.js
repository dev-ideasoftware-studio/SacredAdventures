/**
 * Sacred Adventures - Game Objects Database
 * 
 * This registry acts as the source of truth for the local Natural Language Processing (NLP) engine.
 * It maps user-inputted nouns to actual target names required by the engine's auto-walk logic.
 */

window.GameObjectsDatabase = [
    {
        id: "axe_1",
        aliases: ["axe", "hatchet", "tool", "weapon", "tomahawk", "cleaver"],
        targetName: "axe", // Used by engine's window._lookTarget lookup
        allowedActions: ["get", "take", "grab", "find", "walk", "go", "look", "equip", "pick"]
    },
    {
        id: "rabbit_1",
        aliases: ["rabbit", "bunny", "hare", "animal", "pet", "critter", "rabbits", "bunnies"],
        targetName: "rabbit", // The closest rabbit will be found using getNearestRabbit()
        allowedActions: ["pet", "feed", "walk", "go", "find", "look", "follow", "chase", "hug", "touch"]
    },
    {
        id: "butterfly_1",
        aliases: ["butterfly", "guide", "spirit", "yellow", "bug", "insect", "moth"],
        targetName: "yellowbutterfly",
        allowedActions: ["follow", "find", "look", "walk", "go", "chase"]
    },
    {
        id: "tipi_1",
        aliases: ["tipi", "teepee", "tent", "home", "house", "shelter", "camp"],
        targetName: "tipi",
        allowedActions: ["enter", "go", "walk", "sleep", "rest", "find", "look"]
    },
    {
        id: "bhg_1",
        aliases: ["girl", "bringshappinessgirl", "brings", "happiness", "friend", "npc", "person", "woman"],
        targetName: "bringshappinessgirl",
        allowedActions: ["go", "walk", "find", "look", "follow", "talk", "greet", "meet"]
    },
    {
        id: "deer_1",
        aliases: ["deer", "buck", "doe", "fawn", "stag"],
        targetName: "deer",
        allowedActions: ["go", "walk", "find", "look", "follow", "chase", "pet"]
    },
    {
        id: "naturespirit_1",
        aliases: ["naturespirit", "spirit", "nature", "guardian", "god", "deity"],
        targetName: "naturespirit",
        allowedActions: ["go", "walk", "find", "look", "follow", "meet"]
    }
];
