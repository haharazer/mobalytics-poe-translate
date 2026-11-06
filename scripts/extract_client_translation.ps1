param(
    [ValidateSet("International", "Cn")][Parameter(Mandatory=$true)][string]$Channel,
    [string]$ClientDataRoot = "C:/Users/hanpe/Desktop/poe-client-data",
    [string]$InternationalClient = "E:/Path of Exile",
    [string]$CnClient = "E:/WeGameApps/rail_apps/流放之路(511)",
    [string]$OutputDirectory = "$PSScriptRoot/../.local/client-translation"
)
$ErrorActionPreference = "Stop"
$output = [IO.Path]::GetFullPath($OutputDirectory)
$lib = Join-Path $ClientDataRoot "work/libggpk3-runtime"
$schemaPath = Join-Path $ClientDataRoot "work/dat-schema/schema-poe1.8c84cfbba60b.min.json"
$tables = @("gemeffects", "skillgeminfo", "words", "uniquestashlayout", "passiveskillmasteryeffects", "stats")
foreach ($name in @("SystemExtensions", "Newtonsoft.Json", "LibGGPK3", "LibBundle3", "LibBundledGGPK3", "LibDat2")) {
    [Reflection.Assembly]::LoadFrom((Join-Path $lib "$name.dll")) | Out-Null
}
# The library's default DriveBundleFactory requests write access even for reads.
# Supply a factory whose streams and API cannot write back to the client.
Add-Type -ReferencedAssemblies (Join-Path $lib "LibBundle3.dll") -TypeDefinition @'
using System;
using System.IO;
using LibBundle3;
using LibBundle3.Records;
public sealed class ReadOnlyTranslationBundleFactory : IBundleFactory {
    private readonly string root;
    public ReadOnlyTranslationBundleFactory(string root) { this.root = root; }
    public Bundle GetBundle(BundleRecord record) {
        return new Bundle(File.Open(System.IO.Path.Combine(root, record.Path), FileMode.Open, FileAccess.Read, FileShare.ReadWrite), false, record);
    }
    public Stream CreateBundle(string path) { throw new NotSupportedException("Read-only extractor"); }
    public bool DeleteBundle(string path) { throw new NotSupportedException("Read-only extractor"); }
}
'@
$schema = Get-Content -LiteralPath $schemaPath -Raw | ConvertFrom-Json
$definitions = [Collections.Generic.Dictionary[string,Collections.Generic.KeyValuePair[string,string][]]]::new([StringComparer]::OrdinalIgnoreCase)
$selected = $schema.tables | Where-Object { ($_.validFor -band 1) -ne 0 } | Group-Object name | ForEach-Object {
    $_.Group | Sort-Object @{Expression={if ($_.validFor -eq 1) {0} else {1}}} | Select-Object -First 1
}
foreach ($table in $selected) {
    $columns = [Collections.Generic.List[Collections.Generic.KeyValuePair[string,string]]]::new()
    $unknown = 0
    foreach ($column in $table.columns) {
        $name = $column.name
        if ($null -eq $name) { $name = "Unknown$unknown"; $unknown++ }
        $type = $column.type
        if ($type -eq "array" -or $type -eq "enumrow") { $type = "i32" }
        if ($column.array) { $type = "array|$type" }
        $columns.Add([Collections.Generic.KeyValuePair[string,string]]::new($name, $type))
    }
    $definitions.Add($table.name.ToLowerInvariant(), $columns.ToArray())
}
[LibDat2.DatContainer]::SchemaMinDatDefinitions = $definitions
$inputs = [Collections.Generic.List[object]]::new()
function Hash-Bytes([byte[]]$Bytes) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [Convert]::ToHexString($algorithm.ComputeHash($Bytes)).ToLowerInvariant() }
    finally { $algorithm.Dispose() }
}
function Export-File($Index, [string]$Logical, [string]$Relative, [string]$Table = "") {
    $record = $null
    if (-not $Index.TryGetFile($Logical, [ref]$record)) { throw "Missing client resource: $Logical" }
    $bytes = $record.Read().ToArray()
    $rawHash = Hash-Bytes $bytes
    if ($Table) {
        $dat = [LibDat2.DatContainer]::new($bytes, "$Table.dat64", $true)
        if ($null -ne $dat.Exception) { throw $dat.Exception }
        $bytes = [Text.UTF8Encoding]::new($false).GetBytes($dat.ToCsv())
    }
    $destination = [IO.Path]::GetFullPath((Join-Path $output $Relative))
    if (-not $destination.StartsWith($output + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Output path escaped workspace" }
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
    [IO.File]::WriteAllBytes($destination, $bytes)
    $inputs.Add([ordered]@{path=$Relative.Replace('\','/'); logical_path=$Logical; sha256=(Hash-Bytes $bytes); raw_sha256=$rawHash; size=$bytes.Length})
    Write-Output "Extracted $Relative ($($bytes.Length) bytes)"
}
$containerPath = if ($Channel -eq "International") { Join-Path $InternationalClient "Content.ggpk" } else { Join-Path $CnClient "Bundles2/_.index.bin" }
$before = Get-Item -LiteralPath $containerPath
$sizeBefore = $before.Length; $timeBefore = $before.LastWriteTimeUtc
# Read-only streams also prevent accidental writes through the GGPK/index objects.
$stream = [IO.File]::Open($containerPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
$container = $null
try {
    if ($Channel -eq "International") {
        $container = [LibBundledGGPK3.BundledGGPK]::new($stream, $true, $false)
        $index = $container.Index
        $failed = $index.ParsePaths()
        if ($failed -ne 0) { throw "International path parsing failed for $failed resources" }
        foreach ($table in $tables) {
            Export-File $index "data/$table.datc64" "en/$table.csv" $table
            Export-File $index "data/traditional chinese/$table.datc64" "zh-TW/$table.csv" $table
        }
        $resourceLocale = "en"
    } else {
        $factory = [ReadOnlyTranslationBundleFactory]::new([IO.Path]::GetDirectoryName($containerPath))
        $container = [LibBundle3.Index]::new($stream, $true, $true, $factory)
        $index = $container
        foreach ($table in $tables) { Export-File $index "data/simplified chinese/$table.datc64" "zh-CN/$table.csv" $table }
        $resourceLocale = "zh-CN"
    }
    $statFiles = @($index.Files.Values | Where-Object { $_.Path -like "metadata/statdescriptions/*.txt" } | Sort-Object Path)
    foreach ($resource in $statFiles) {
        Export-File $index $resource.Path "$resourceLocale/statdescriptions/$([IO.Path]::GetFileName($resource.Path))"
    }
} finally {
    if ($container) { $container.Dispose() }
    $stream.Dispose()
}
$after = Get-Item -LiteralPath $containerPath
if ($after.Length -ne $sizeBefore -or $after.LastWriteTimeUtc -ne $timeBefore) { throw "Client changed during read-only extraction; snapshot is not stable" }
$manifest = [ordered]@{
    schema_version=1; game="poe1"; adapter="client-translation-snapshot"; channel=$Channel
    container=[ordered]@{name=$before.Name; size=$sizeBefore; last_write_utc=$timeBefore.ToString("O")}
    schema=[ordered]@{filename=[IO.Path]::GetFileName($schemaPath); sha256=(Hash-Bytes ([IO.File]::ReadAllBytes($schemaPath)))}
    inputs=$inputs.ToArray()
}
[IO.File]::WriteAllText((Join-Path $output "$($Channel.ToLowerInvariant()).manifest.json"), ($manifest | ConvertTo-Json -Depth 10), [Text.UTF8Encoding]::new($false))
