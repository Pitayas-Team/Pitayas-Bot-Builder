module.exports = {
    name: "Modal Choice Option (Radio / Checkbox Group)",

    description: "Creates an option for a Modal Radio Group or a Modal Checkbox Group.",

    category: "Component Stuff",

    auto_execute: true,

    inputs(data) {
        if (!data?.options?.show_inputs) return;

        return [
            {
                id: "action",
                name: "Action",
                description: "Executes this block.",
                types: ["action"]
            },
            {
                id: "label",
                name: "Label",
                description: "The label for this option.",
                types: ["text", "unspecified"]
            },
            {
                id: "value",
                name: "Value",
                description: "The value for this option. You get it back when the modal is submitted.",
                types: ["text", "unspecified"]
            },
            {
                id: "description",
                name: "Description",
                description: "The description of this option.",
                types: ["text", "unspecified"]
            },
            {
                id: "default",
                name: "Default?",
                description: "Whether this option is selected by default.",
                types: ["boolean", "unspecified"]
            }
        ];
    },

    options: [
        {
            id: "show_inputs",
            name: "Enable Inputs?",
            description: "If enabled, this block will use inputs and allow action chaining.",
            type: "CHECKBOX"
        },
        {
            id: "label",
            name: "Label (Max 100 Chars)",
            description: "The label for this option. [REQUIRED]",
            type: "TEXT",
            max: 100
        },
        {
            id: "value",
            name: "Value (Max 100 Chars)",
            description: "The value for this option. You get it back when the modal is submitted. [REQUIRED]",
            type: "TEXT",
            max: 100
        },
        {
            id: "description",
            name: "Description (Max 100 Chars)",
            description: "The description of this option. Optional.",
            type: "TEXT",
            max: 100
        },
        {
            id: "default",
            name: "Default?",
            description: "Whether this option is selected by default.",
            type: "CHECKBOX"
        }
    ],

    outputs(data) {
        const outputs = [
            {
                id: "choice_option",
                name: "Choice Option",
                description: "Type: Object\n\nDescription: The option for a Radio Group or a Checkbox Group.",
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
        const executedFrom = cache.executedFrom?.[0];
        const showinputs = this.GetOptionValue("show_inputs", cache);
        if (executedFrom != "action" && showinputs) return;

        const get = (id) => showinputs ? (this.GetInputValue(id, cache) ?? this.GetOptionValue(id, cache)) : this.GetOptionValue(id, cache);

        const label = get("label");
        const value = get("value");
        const description = get("description");
        const isDefault = get("default");

        if (!label || String(label).length <= 0) return this.end(new Error("Label is required!"), true, false);
        if (!value || String(value).length <= 0) return this.end(new Error("Value is required!"), true, false);

        // Zwykły obiekt: grupa radio i grupa checkboxów budują z niego własne opcje (każda ma inny typ opcji)
        const option = { label: String(label), value: String(value) };
        if (description && String(description).length > 0) option.description = String(description);
        if (isDefault) option.default = true;

        this.StoreOutputValue(option, "choice_option", cache, "inputBlock");

        if (executedFrom === "action") {
            this.RunNextBlock("action", cache);
        }
    }
};
