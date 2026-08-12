//! Verifies the desktop OAuth loopback without a GUI: a real TCP round-trip
//! (a fake "browser" GET to the listener) plus the query-string parsing that
//! extracts the authorization code.
//!
//!   cargo run --example oauth_loopback_check

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use vuaassistant_lib::auth::{handle_connection, query_param};

fn main() {
    // --- Pure parsing, including percent-encoding ---
    let line = "GET /callback?code=abc123&state=xyz HTTP/1.1";
    assert_eq!(query_param(line, "code").as_deref(), Some("abc123"));
    assert_eq!(query_param(line, "state").as_deref(), Some("xyz"));
    assert_eq!(query_param(line, "missing"), None);
    assert_eq!(
        query_param("GET /callback?code=a%2Bb%20c HTTP/1.1", "code").as_deref(),
        Some("a+b c"),
    );
    assert_eq!(query_param("GET /callback HTTP/1.1", "code"), None);
    println!("✓ query_param parses code, state, percent-encoding, and misses");

    // --- Real loopback: listener + a fake browser redirect ---
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().unwrap().port();

    let server = std::thread::spawn(move || {
        let (stream, _) = listener.accept().expect("accept");
        handle_connection(stream)
    });

    let mut client = TcpStream::connect(("127.0.0.1", port)).expect("connect");
    client
        .write_all(
            b"GET /callback?code=LOOPBACK_CODE_123&scope=x HTTP/1.1\r\nHost: localhost\r\n\r\n",
        )
        .unwrap();

    let mut reader = BufReader::new(&client);
    let mut status = String::new();
    reader.read_line(&mut status).unwrap();
    assert!(status.starts_with("HTTP/1.1 200"), "status: {status}");

    let code = server.join().unwrap();
    assert_eq!(code.as_deref(), Some("LOOPBACK_CODE_123"));
    println!("✓ loopback round-trip: browser redirect → code received, 200 page served");
    println!("✓ desktop OAuth loopback contract holds");
}
