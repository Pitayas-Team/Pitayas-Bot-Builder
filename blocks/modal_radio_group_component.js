module.exports = {
    name: "Modal Radio Group (Component)",

    description: "Creates a Radio Group (the user picks exactly one option) for ONLY MODALS. Put it into a Label (Component) to show it in a modal.",

    category: "Component Stuff",

    auto_execute: true,

    inputs(data) {
        const optionsInput = {
            id: "options",
            name: "Option",
            description: "The options of the Radio Group (2 to 10). Use the Modal Choice Option block.",
            types: ["object", "unspecified"],
            multiInput: true,
            max: 10
        };

        if (!data?.options?.show_inputs) return [optionsInput];

        return [
            {
                id: "action",
                name: "Action",
                description: "Executes this block.",
                types: ["action"]
            },
            {
                id: "customid",
                name: "Custom ID",
                description: "The Custom ID for the component.",
                types: ["text", "unspecified"]
            },
            {
                id: "required",
                name: "Required?",
                description: "Whether the component is required or not.",
                types: ["boolean", "unspecified"]
            },
            optionsInput
        ];
    },

    options: [
        {
            id: "show_inputs",
            name: "Enable Inputs?",
            description: "If enabled, allows chaining and overrides text via input.",
            type: "CHECKBOX"
        },
        {
            id: "customid",
            name: "Custom ID (Max 100 Chars)",
            description: "The Custom ID for the component. This is required!",
            type: "TEXT",
            max: 100
        },
        {
            id: "required",
            name: "Required?",
            description: "Whether the user has to pick an option.",
            type: "CHECKBOX",
            defaultValue: true
        }
    ],

    outputs(data) {
        const outputs = [
            {
                id: "radioGroupComponent",
                name: "Radio Group (Component)",
                description: "The Radio Group component.",
                types: ["object"]
            }
        ];

        if (data?.options?.show_inputs) {
            outputs.unshift({
                id: "action",
                name: "Action",
                description: "Executes this block.",
                types: ["action"]
            });
        }

        return outputs;
    },

    code(cache) {
        const discord = require("discord.js");
        const { RadioGroupBuilder, RadioGroupOptionBuilder } = discord;

        if (!RadioGroupBuilder || !RadioGroupOptionBuilder) {
            return this.end(new Error("Radio Groups need a newer discord.js. Update it in your project (npm update discord.js)."), true, false);
        }

        const executedFrom = cache.executedFrom?.[0];
        const showinputs = this.GetOptionValue("show_inputs", cache);
        if (executedFrom != "action" && showinputs) return;

        const get = (id) => showinputs ? (this.GetInputValue(id, cache) ?? this.GetOptionValue(id, cache)) : this.GetOptionValue(id, cache);
        const customId = get("customid");
        const required = get("required");
        const options = (this.GetInputValue("options", cache, { fetch: true }) ?? []).filter((a) => a);

        if (!customId || customId.length <= 0) return this.end(new Error("Custom ID is required!"), true, false);
        if (options.length < 2) return this.end(new Error("A Radio Group needs at least 2 options!"), true, false);
        if (options.length > 10) return this.end(new Error("A Radio Group can have at most 10 options!"), true, false);

        const radioGroup = new RadioGroupBuilder().setCustomId(customId);
        if (required !== undefined && required !== "") radioGroup.setRequired(Boolean(required));

        for (const o of options) {
            const option = new RadioGroupOptionBuilder().setLabel(o.label).setValue(o.value);
            if (o.description) option.setDescription(o.description);
            if (o.default) option.setDefault(true);
            radioGroup.addOptions(option);
        }

        this.StoreOutputValue(radioGroup, "radioGroupComponent", cache, "inputBlock");

        if (executedFrom === "action") {
            this.RunNextBlock("action", cache);
        }
    }
};
