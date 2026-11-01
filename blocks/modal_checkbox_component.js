module.exports = {
    name: "Modal Checkbox (Component)",

    description: "Creates a single Checkbox (yes / no) for ONLY MODALS. Put it into a Label (Component) to show it in a modal.",

    category: "Component Stuff",

    auto_execute: true,

    inputs(data) {
        if (!data?.options?.show_inputs) return [];

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
                id: "default",
                name: "Checked by default?",
                description: "Whether the checkbox is ticked when the modal opens.",
                types: ["boolean", "unspecified"]
            }
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
            id: "default",
            name: "Checked by default?",
            description: "Whether the checkbox is ticked when the modal opens.",
            type: "CHECKBOX"
        }
    ],

    outputs(data) {
        const outputs = [
            {
                id: "checkboxComponent",
                name: "Checkbox (Component)",
                description: "The Checkbox component.",
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
        const { CheckboxBuilder } = require("discord.js");

        if (!CheckboxBuilder) {
            return this.end(new Error("Checkboxes need a newer discord.js. Update it in your project (npm update discord.js)."), true, false);
        }

        const executedFrom = cache.executedFrom?.[0];
        const showinputs = this.GetOptionValue("show_inputs", cache);
        if (executedFrom != "action" && showinputs) return;

        const get = (id) => showinputs ? (this.GetInputValue(id, cache) ?? this.GetOptionValue(id, cache)) : this.GetOptionValue(id, cache);
        const customId = get("customid");
        const isDefault = get("default");

        if (!customId || customId.length <= 0) return this.end(new Error("Custom ID is required!"), true, false);

        const checkbox = new CheckboxBuilder().setCustomId(customId);
        if (isDefault) checkbox.setDefault(true);

        this.StoreOutputValue(checkbox, "checkboxComponent", cache, "inputBlock");

        if (executedFrom === "action") {
            this.RunNextBlock("action", cache);
        }
    }
};
