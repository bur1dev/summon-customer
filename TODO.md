/// SUMMON-CUSTOMER ///

2.1.No delivery time in CheckoutSummary.svelte

3.1 Figure out if propagation after removing embeddings from DHT is better. Debug what is going on. Why in the products.dna system, AGENT 2 is stuck and doesn't see products that agent 1 uploaded (only at 300000 products)

ASK HOLOCHAIN COMMUNITY ABOUT THESE ERRORS: 

[1] [hc-spin] | [hc sandbox] ERROR: 2025-07-19T17:30:15.479224Z ERROR holochain::core::workflow::sys_validation_workflow: crates/holochain/src/core/workflow/sys_validation_workflow.rs:193: Error fetching missing dependency error=NetworkError(Other("get response channel dropped: likely response timeout"))
[1] [hc-spin] | [hc sandbox] ERROR: 2025-07-19T17:30:19.252942Z ERROR holochain::core::ribosome::real_ribosome: crates/holochain/src/core/ribosome/real_ribosome.rs:701: runtime_error=RuntimeError { source: Sys(User(WasmError { file: "crates/holochain/src/core/ribosome/host_fn/get_links.rs", line: 76, error: Host("Other: get_links response channel dropped: likely response timeout") })), wasm_trace: [] } zome=Zome { name: ZomeName("product_catalog"), def: Wasm(WasmZome { wasm_hash: WasmHash(uhCokpCUvS0VzuhRL92kCQ2wel1YjwDZTuMmkbNEsXgJMNrQ3PPya), dependencies: [ZomeName("product_catalog_integrity")], preserialized_path: None }) } fn_name=FunctionName("get_products_by_category")
[1] [hc-spin] | [hc sandbox] ERROR: 2025-07-19T17:30:19.253823Z ERROR holochain::core::ribosome::real_ribosome: crates/holochain/src/core/ribosome/real_ribosome.rs:701: runtime_error=RuntimeError { source: Sys(User(WasmError { file: "crates/holochain/src/core/ribosome/host_fn/get_links.rs", line: 76, error: Host("Other: get_links response channel dropped: likely response timeout") })), wasm_trace: [] } zome=Zome { name: ZomeName("product_catalog"), def: Wasm(WasmZome { wasm_hash: WasmHash(uhCokpCUvS0VzuhRL92kCQ2wel1YjwDZTuMmkbNEsXgJMNrQ3PPya), dependencies: [ZomeName("product_catalog_integrity")], preserialized_path: None }) } fn_name=FunctionName("get_products_by_category")

/// SUMMON-SHOPPER ///

1.1 "Scan barcode" message step appears twice when scanning items (minor bug).
1.2 UI improvements, scanning products, etc. 

2.1 FIGURE OUT CLONE DISCOVERY SYSTEM. Research best practices.
2.2 THINK ABOUT SIGNALING SYSTEM (updating linnks + signals for real time updates)
2.3 Deeply think about the clone cell lifecycle. 

