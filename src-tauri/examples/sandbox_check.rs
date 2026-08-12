//! Proves the WASM sandbox contains guest code: a normal guest runs, a
//! runaway guest is trapped by the fuel cap (the host survives), and a guest
//! that asks for host access is denied. Run: `cargo run --example sandbox_check`.

use vuaassistant_lib::sandbox::run_capped;

fn main() {
    let mut ok = true;
    let mut check = |name: &str, cond: bool| {
        println!("{} {}", if cond { "✓" } else { "✗" }, name);
        if !cond {
            ok = false;
        }
    };

    const MEM: usize = 16 * 1024 * 1024;

    // 1. A normal compute guest runs and returns its result.
    let add = r#"(module (func (export "run") (result i64) i64.const 40 i64.const 2 i64.add))"#;
    let r1 = run_capped(add, 1_000_000, MEM).expect("run");
    check("compute guest returns 42", r1.value == Some(42) && !r1.trapped);

    // 2. A runaway (infinite loop) guest is stopped by the fuel cap; the host
    //    process keeps running (we reach the next check).
    let spin = r#"(module (func (export "run") (result i64) (loop (br 0)) i64.const 0))"#;
    let r2 = run_capped(spin, 100_000, MEM).expect("run");
    check("runaway guest trapped by fuel; host alive", r2.trapped);

    // 3. A guest that imports a host function is denied — no host capability is
    //    handed to sandboxed code.
    let importer = r#"(module (import "host" "danger" (func)) (func (export "run") (result i64) i64.const 0))"#;
    let r3 = run_capped(importer, 1_000_000, MEM).expect("run");
    check(
        "guest requesting host access is denied",
        r3.trapped && r3.message.contains("import"),
    );

    println!(
        "{}",
        if ok {
            "\n\u{2713} WASM sandbox contains guest code"
        } else {
            "\n\u{2717} FAILED"
        }
    );
    std::process::exit(if ok { 0 } else { 1 });
}
