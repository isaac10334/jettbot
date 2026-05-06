pub fn i16_samples_to_le_bytes(samples: &[i16]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(samples.len() * 2);
    for sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_samples() {
        assert_eq!(i16_samples_to_le_bytes(&[1, -2]), vec![1, 0, 254, 255]);
    }
}
