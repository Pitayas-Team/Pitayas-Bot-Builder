module.exports = {
    name: "Modal Checkbox Group (Component)",

    description: "Creates a Checkbox Group (the user can tick several options) for ONLY MODALS. Put it into a Label (Component) to show it in a modal.",

    category: "Component Stuff",

    auto_execute: true,

    inputs(data) {
        const optionsInput = {
            id: "options",
            name: "Option",
            description: "The options of the Checkbox Group (1 to 10). Use the Modal Choice Option block.",
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
                id: "min_values",
                name: "Minimum Values",
                description: "The minimum number of options the user has to tick.",
                types: ["number", "unspecified"]
            },
            {
                id: "max_values",
                name: "Maximum Values",
                description: "The maximum number of options the user can tick.",
                types: ["number", "unspecified"]
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
            id: "min_values",
            name: "Minimum Values",
            description: "The minimum number of options the user has to tick. Use 0 together with Required? turned off.",
            type: "NUMBER",
            min: 0,
            max: 10,
            defaultValue: 1
        },
        {
            id: "max_values",
            name: "Maximum Values",
            description: "The maximum number of options the user can tick. Leave empty to allow all options.",
            type: "NUMBER",
            min: 1,
            max: 10
        },
        {
            id: "required",
            name: "Required?",
            description: "Whether the user has to tick something.",
            type: "CHECKBOX",
            defaultValue: true
        }
    ],

    outputs(data) {
        const outputs = [
            {
                id: "checkboxGroupComponent",
                name: "Checkbox Group (Component)",
                description: "The Checkbox Group component.",
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
        const { CheckboxGroupBuilder, CheckboxGroupOptionBuilder } = discord;

        if (!CheckboxGroupBuilder || !CheckboxGroupOptionBuilder) {
            return this.end(new Error("Checkbox Groups need a newer discord.js. Update it in your project (npm update discord.js)."), true, false);
        }

        const executedFrom = cache.executedFrom?.[0];
        const showinputs = this.GetOptionValue("show_inputs", cache);
        if (executedFrom != "action" && showinputs) return;

        const get = (id) => showinputs ? (this.GetInputValue(id, cache) ?? this.GetOptionValue(id, cache)) : this.GetOptionValue(id, cache);
        const customId = get("customid");
        const minValues = get("min_values");
        const maxValues = get("max_values");
        const required = get("required");
        const options = (this.GetInputValue("options", cache, { fetch: true }) ?? []).filter((a) => a);

        if (!customId || customId.length <= 0) return this.end(new Error("Custom ID is required!"), true, false);
        if (options.length < 1) return this.end(new Error("A Checkbox Group needs at least 1 option!"), true, false);
        if (options.length > 10) return this.end(new Error("A Checkbox Group can have at most 10 options!"), true, false);

        const checkboxGroup = new CheckboxGroupBuilder().setCustomId(customId);
        if (minValues !== undefined && minValues !== "" && minValues !== null) checkboxGroup.setMinValues(Number(minValues));
        if (maxValues !== undefined && maxValues !== "" && maxValues !== null) checkboxGroup.setMaxValues(Number(maxValues));
        if (required !== undefined && required !== "") checkboxGroup.setRequired(Boolean(required));

        for (const o of options) {
            const option = new CheckboxGroupOptionBuilder().setLabel(o.label).setValue(o.value);
            if (o.description) option.setDescription(o.description);
            if (o.default) option.setDefault(true);
            checkboxGroup.addOptions(option);
        }

        this.StoreOutputValue(checkboxGroup, "checkboxGroupComponent", cache, "inputBlock");

        if (executedFrom === "action") {
            this.RunNextBlock("action", cache);
        }
    }
};
