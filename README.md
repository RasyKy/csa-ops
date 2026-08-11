## Purpose and Ethical Use

CSA-OPS is a defense-focused project. The attack scripts included here are 
benign simulations, not functional malware. They are designed to produce 
realistic Windows telemetry (e.g. triggering a Sysmon event for LSASS access) 
without performing the actual malicious action (e.g. without dumping or 
reading real credentials). Each script maps to a specific MITRE ATT&CK 
technique and exists solely to test the detection engine in this repository.

These scripts are intended to run only against machines you own or are 
authorized to test, on an isolated private network. Running these — or any 
attack techniques — against systems you do not own or have explicit permission 
to test is illegal.

This project was built as a hands-on learning exercise in detection 
engineering, not as a production security tool.
