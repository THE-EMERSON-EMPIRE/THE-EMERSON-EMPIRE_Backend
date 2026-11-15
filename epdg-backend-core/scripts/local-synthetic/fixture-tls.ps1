param([Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference='Stop'
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$fixtureRoot=[IO.Path]::GetFullPath((Join-Path $repoRoot '.local-synthetic'))+[IO.Path]::DirectorySeparatorChar
$resolved=[IO.Path]::GetFullPath($Directory)
if(-not $resolved.StartsWith($fixtureRoot,[StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath (Join-Path $resolved 'pgdata/PG_VERSION'))){throw 'Only a task-owned PostgreSQL fixture is accepted'}
$tlsDirectory=Join-Path $resolved 'private-tls'
New-Item -ItemType Directory -Path $tlsDirectory -ErrorAction Stop | Out-Null
$owner=[Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls $tlsDirectory /inheritance:r /grant:r ($owner+':(OI)(CI)F') | Out-Null
$caKey=[Security.Cryptography.RSA]::Create(2048)
$caRequest=[Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=SYNTHETIC EPDG fixture CA',$caKey,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)
$caRequest.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true,$false,0,$true))
$caRequest.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign,$true))
$start=[DateTimeOffset]::UtcNow.AddMinutes(-5);$end=[DateTimeOffset]::UtcNow.AddDays(2)
$ca=$caRequest.CreateSelfSigned($start,$end)
$key=[Security.Cryptography.RSA]::Create(2048)
$request=[Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=localhost',$key,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)
$request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false,$false,0,$true))
$san=[Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
$san.AddDnsName('localhost');$san.AddIpAddress([Net.IPAddress]::Parse('127.0.0.1'));$request.CertificateExtensions.Add($san.Build())
$request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(([Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment),$true))
$eku=[Security.Cryptography.OidCollection]::new();[void]$eku.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1'))
$request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($eku,$true))
$cert=$request.Create($ca,$start,$end,[Security.Cryptography.RandomNumberGenerator]::GetBytes(16))
[IO.File]::WriteAllText((Join-Path $tlsDirectory 'ca.pem'),$ca.ExportCertificatePem())
[IO.File]::WriteAllText((Join-Path $tlsDirectory 'server.pem'),$cert.ExportCertificatePem())
[IO.File]::WriteAllText((Join-Path $tlsDirectory 'server.key'),$key.ExportPkcs8PrivateKeyPem())
$key.Dispose();$caKey.Dispose();$ca.Dispose();$cert.Dispose()
Write-Output 'Task-owned fixture TLS material generated without changing trust stores.'
